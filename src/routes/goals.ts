import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { XP, awardXp, revokeXp, syncRewards } from '../domain/gamification.js';
import { loadTasks, serializeTask } from '../domain/schedule.js';
import { HttpError, addDays, handler, isValidDate, notFound, parse, pct } from '../util.js';
import { dateRange } from '../util.js';
import { occursOn } from '../domain/schedule.js';
import { loadLogs } from '../domain/schedule.js';

const date = z.string().refine(isValidDate, 'Use YYYY-MM-DD');
const status = z.enum(['not_started', 'in_progress', 'completed', 'paused']);

const goalFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  category: z.string().trim().min(1).max(30),
  startDate: date.nullable(),
  targetDate: date.nullable(),
  priority: z.enum(['low', 'medium', 'high']),
  targetValue: z.number().positive().nullable(),
  currentValue: z.number().min(0),
  unit: z.string().max(30),
  status,
};
const createSchema = z
  .object({ ...goalFields, milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), dueDate: date.nullable().optional() })).max(50) })
  .partial()
  .required({ title: true });
const updateSchema = z.object(goalFields).partial();

interface GoalRow {
  id: number; user_id: number; title: string; description: string; category: string; start_date: string | null;
  target_date: string | null; priority: string; target_value: number | null; current_value: number; unit: string;
  status: string; completed_at: string | null; demo: number;
}
interface MilestoneRow { id: number; goal_id: number; title: string; due_date: string | null; done: number; done_at: string | null; sort_order: number }

export function goalsRouter(db: DB): Router {
  const r = Router();

  const owned = (u: { id: number; demo: number }, id: number): GoalRow => {
    const g = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ? AND demo = ?').get(id, u.id, u.demo) as GoalRow | undefined;
    if (!g) throw notFound('Goal');
    return g;
  };

  /** Progress: milestones if the goal has any, otherwise measurable target. Never guessed. */
  const progressOf = (g: GoalRow, ms: MilestoneRow[]) => {
    if (g.status === 'completed') return { percent: 100, basis: 'status' as const };
    if (ms.length) return { percent: pct(ms.filter((m) => m.done).length, ms.length) ?? 0, basis: 'milestones' as const };
    if (g.target_value) return { percent: Math.min(100, Math.round((g.current_value / g.target_value) * 100)), basis: 'measurable_target' as const };
    return { percent: null as number | null, basis: 'none' as const };
  };

  const serialize = (u: { id: number; demo: number; today: string }, g: GoalRow, withDetail = false) => {
    const ms = db.prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY sort_order, id').all(g.id) as MilestoneRow[];
    const prog = progressOf(g, ms);
    const daysLeft = g.target_date ? Math.round((Date.parse(g.target_date) - Date.parse(u.today)) / 86_400_000) : null;
    const base = {
      id: g.id, title: g.title, description: g.description, category: g.category, startDate: g.start_date, targetDate: g.target_date,
      priority: g.priority, targetValue: g.target_value, currentValue: g.current_value, unit: g.unit, status: g.status,
      completedAt: g.completed_at, progressPercent: prog.percent, progressBasis: prog.basis, daysLeft,
      overdue: !!g.target_date && g.target_date < u.today && g.status !== 'completed',
      milestones: ms.map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, done: !!m.done, doneAt: m.done_at })),
    };
    if (!withDetail) return base;
    // Habits and tasks linked to this goal, with their last-30-day follow-through.
    const from = addDays(u.today, -29);
    const linked = loadTasks(db, u as never).filter((t) => t.goal_id === g.id);
    const logs = loadLogs(db, u as never, from, u.today);
    return {
      ...base,
      linkedTasks: linked.map((t) => {
        let planned = 0, completed = 0;
        for (const d of dateRange(from, u.today)) {
          const l = logs.find((x) => x.task_id === t.id && x.date === d);
          if (!occursOn(t, d) && !l) continue;
          planned++;
          if (l?.status === 'completed') completed++;
        }
        return { ...serializeTask(t), last30Days: { planned, completed, completionPercent: pct(completed, planned) } };
      }),
    };
  };

  r.get(
    '/goals',
    handler((req, res) => {
      const rows = db.prepare('SELECT * FROM goals WHERE user_id = ? AND demo = ? ORDER BY created_at DESC, id DESC').all(req.user.id, req.user.demo) as GoalRow[];
      const st = typeof req.query.status === 'string' ? req.query.status : null;
      const cat = typeof req.query.category === 'string' ? req.query.category : null;
      res.json(rows.filter((g) => (!st || g.status === st) && (!cat || g.category === cat)).map((g) => serialize(req.user, g)));
    }),
  );

  r.post(
    '/goals',
    handler((req, res) => {
      const b = parse(createSchema, req.body);
      const u = req.user;
      if (b.startDate && b.targetDate && b.targetDate < b.startDate) throw new HttpError(400, 'Target date is before start date');
      const id = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO goals (user_id, title, description, category, start_date, target_date, priority, target_value, current_value, unit, status, demo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(u.id, b.title, b.description ?? '', b.category ?? 'Personal', b.startDate ?? u.today, b.targetDate ?? null, b.priority ?? 'medium',
            b.targetValue ?? null, b.currentValue ?? 0, b.unit ?? '', b.status === 'completed' ? 'in_progress' : b.status ?? 'not_started', u.demo);
        const gid = Number(info.lastInsertRowid);
        (b.milestones ?? []).forEach((m, i) =>
          db.prepare('INSERT INTO milestones (goal_id, user_id, title, due_date, sort_order) VALUES (?, ?, ?, ?, ?)').run(gid, u.id, m.title, m.dueDate ?? null, i + 1));
        return gid;
      })();
      res.status(201).json(serialize(u, owned(u, id), true));
    }),
  );

  r.get('/goals/:id', handler((req, res) => res.json(serialize(req.user, owned(req.user, Number(req.params.id)), true))));

  r.patch(
    '/goals/:id',
    handler((req, res) => {
      const u = req.user;
      const cur = owned(u, Number(req.params.id));
      const b = parse(updateSchema, req.body);
      const start = b.startDate !== undefined ? b.startDate : cur.start_date;
      const target = b.targetDate !== undefined ? b.targetDate : cur.target_date;
      if (start && target && target < start) throw new HttpError(400, 'Target date is before start date');
      const newStatus = b.status ?? cur.status;
      const completing = newStatus === 'completed' && cur.status !== 'completed';
      const reopening = newStatus !== 'completed' && cur.status === 'completed';
      db.prepare(
        `UPDATE goals SET title=?, description=?, category=?, start_date=?, target_date=?, priority=?, target_value=?, current_value=?, unit=?, status=?, completed_at=? WHERE id=?`,
      ).run(
        b.title ?? cur.title, b.description ?? cur.description, b.category ?? cur.category, start, target, b.priority ?? cur.priority,
        b.targetValue !== undefined ? b.targetValue : cur.target_value, b.currentValue ?? cur.current_value, b.unit ?? cur.unit, newStatus,
        completing ? new Date().toISOString() : reopening ? null : cur.completed_at, cur.id,
      );
      let rewards;
      if (completing) awardXp(db, u, 'goal', String(cur.id), XP.goal, u.today);
      if (reopening) revokeXp(db, u, 'goal', String(cur.id));
      // auto-start: adding progress to a not-started goal moves it to in_progress
      if (b.currentValue && b.currentValue > 0 && cur.status === 'not_started' && !b.status) db.prepare("UPDATE goals SET status='in_progress' WHERE id=?").run(cur.id);
      if (completing) rewards = syncRewards(db, u);
      res.json({ goal: serialize(u, owned(u, cur.id), true), rewards, celebrate: completing });
    }),
  );

  r.delete(
    '/goals/:id',
    handler((req, res) => {
      const u = req.user;
      const g = owned(u, Number(req.params.id));
      revokeXp(db, u, 'goal', String(g.id));
      db.prepare('DELETE FROM goals WHERE id = ?').run(g.id); // tasks keep existing (goal_id -> NULL)
      res.json({ ok: true });
    }),
  );

  // ----- milestones -----

  r.post(
    '/goals/:id/milestones',
    handler((req, res) => {
      const u = req.user;
      const g = owned(u, Number(req.params.id));
      const b = parse(z.object({ title: z.string().trim().min(1).max(200), dueDate: date.nullable().optional() }), req.body);
      const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM milestones WHERE goal_id = ?').get(g.id) as { n: number }).n;
      db.prepare('INSERT INTO milestones (goal_id, user_id, title, due_date, sort_order) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, b.title, b.dueDate ?? null, next);
      res.status(201).json(serialize(u, owned(u, g.id), true));
    }),
  );

  r.patch(
    '/goals/:id/milestones/:mid',
    handler((req, res) => {
      const u = req.user;
      const g = owned(u, Number(req.params.id));
      const m = db.prepare('SELECT * FROM milestones WHERE id = ? AND goal_id = ?').get(Number(req.params.mid), g.id) as MilestoneRow | undefined;
      if (!m) throw notFound('Milestone');
      const b = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), dueDate: date.nullable().optional(), done: z.boolean().optional() }), req.body);
      const done = b.done ?? !!m.done;
      db.prepare('UPDATE milestones SET title=?, due_date=?, done=?, done_at=? WHERE id=?').run(
        b.title ?? m.title, b.dueDate !== undefined ? b.dueDate : m.due_date, done ? 1 : 0, done ? (m.done ? m.done_at : new Date().toISOString()) : null, m.id,
      );
      if (done && !m.done) awardXp(db, u, 'milestone', String(m.id), XP.milestone, u.today);
      if (!done && m.done) revokeXp(db, u, 'milestone', String(m.id));
      if (g.status === 'not_started' && done) db.prepare("UPDATE goals SET status='in_progress' WHERE id=?").run(g.id);
      const rewards = syncRewards(db, u);
      res.json({ goal: serialize(u, owned(u, g.id), true), rewards, celebrate: done && !m.done });
    }),
  );

  r.delete(
    '/goals/:id/milestones/:mid',
    handler((req, res) => {
      const u = req.user;
      const g = owned(u, Number(req.params.id));
      revokeXp(db, u, 'milestone', String(req.params.mid));
      const info = db.prepare('DELETE FROM milestones WHERE id = ? AND goal_id = ?').run(Number(req.params.mid), g.id);
      if (!info.changes) throw notFound('Milestone');
      res.json({ ok: true });
    }),
  );

  return r;
}
