import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { XP, awardXp, syncRewards } from '../domain/gamification.js';
import { dayItems, serializeDayItem } from '../domain/schedule.js';
import { HttpError, addDays, handler, notFound, parse } from '../util.js';
import { parseDate } from './tasks.js';

interface Row { id: number; task_id: number | null; date: string; work_min: number; break_min: number; actual_min: number; completed: number }
const ser = (r: Row) => ({ id: r.id, taskId: r.task_id, date: r.date, workMin: r.work_min, breakMin: r.break_min, actualMin: r.actual_min, completed: !!r.completed });

export function focusRouter(db: DB): Router {
  const r = Router();

  /**
   * Short list for the distraction-free screen: today's open tasks ordered by what to do next
   * (in progress first, then high priority, then earliest scheduled time).
   */
  r.get(
    '/focus/queue',
    handler((req, res) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      const open = dayItems(db, req.user, req.user.today)
        .filter((i) => i.status === 'not_started' || i.status === 'in_progress')
        .sort((a, b) =>
          Number(b.status === 'in_progress') - Number(a.status === 'in_progress') ||
          rank[a.task.priority] - rank[b.task.priority] ||
          (a.task.scheduled_time ?? '99:99').localeCompare(b.task.scheduled_time ?? '99:99'));
      res.json({ next: open[0] ? serializeDayItem(open[0]) : null, queue: open.slice(0, 5).map(serializeDayItem), pomodoro: req.user.settings.pomodoro });
    }),
  );

  /**
   * Log a finished (or abandoned) session. The timer itself runs in the client;
   * the server stores what actually happened. Only completed sessions earn XP.
   */
  r.post(
    '/focus/sessions',
    handler((req, res) => {
      const u = req.user;
      const b = parse(
        z.object({
          taskId: z.number().int().nullable().optional(),
          date: z.string().optional(),
          workMin: z.number().int().min(1).max(180),
          breakMin: z.number().int().min(0).max(60).default(5),
          actualMin: z.number().int().min(0).max(300),
          completed: z.boolean(),
        }),
        req.body,
      );
      const d = b.date ? parseDate(b.date) : u.today;
      if (d > u.today) throw new HttpError(400, 'Session date is in the future');
      if (b.taskId != null && !db.prepare('SELECT 1 FROM tasks WHERE id = ? AND user_id = ? AND demo = ?').get(b.taskId, u.id, u.demo)) {
        throw new HttpError(400, 'That task does not exist');
      }
      // A "completed" session must have run at least most of its planned work time.
      const completed = b.completed && b.actualMin >= Math.ceil(b.workMin * 0.8);
      const info = db
        .prepare('INSERT INTO focus_sessions (user_id, task_id, date, work_min, break_min, actual_min, completed, demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(u.id, b.taskId ?? null, d, b.workMin, b.breakMin, b.actualMin, completed ? 1 : 0, u.demo);
      const id = Number(info.lastInsertRowid);
      let rewards;
      if (completed) {
        awardXp(db, u, 'focus', String(id), XP.focus, d);
        rewards = syncRewards(db, u);
      }
      res.status(201).json({ session: ser(db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id) as Row), rewards, celebrate: completed });
    }),
  );

  r.get(
    '/focus/sessions',
    handler((req, res) => {
      const u = req.user;
      const to = typeof req.query.to === 'string' ? parseDate(req.query.to) : u.today;
      const from = typeof req.query.from === 'string' ? parseDate(req.query.from) : addDays(to, -29);
      const rows = db.prepare('SELECT * FROM focus_sessions WHERE user_id = ? AND demo = ? AND date BETWEEN ? AND ? ORDER BY id DESC').all(u.id, u.demo, from, to) as Row[];
      const done = rows.filter((x) => x.completed);
      res.json({
        sessions: rows.map(ser),
        totals: { sessions: rows.length, completed: done.length, focusMinutes: rows.reduce((s, x) => s + x.actual_min, 0), longestSessionMin: rows.reduce((m, x) => Math.max(m, x.actual_min), 0) },
      });
    }),
  );

  r.delete(
    '/focus/sessions/:id',
    handler((req, res) => {
      const u = req.user;
      const row = db.prepare('SELECT id FROM focus_sessions WHERE id = ? AND user_id = ? AND demo = ?').get(Number(req.params.id), u.id, u.demo);
      if (!row) throw notFound('Session');
      db.prepare("DELETE FROM xp_events WHERE user_id = ? AND demo = ? AND kind = 'focus' AND ref = ?").run(u.id, u.demo, String(req.params.id));
      db.prepare('DELETE FROM focus_sessions WHERE id = ?').run(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  return r;
}
