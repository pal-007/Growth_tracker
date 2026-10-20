import { Router } from 'express';
import { z } from 'zod';
import type { AuthedUser } from '../auth.js';
import type { DB } from '../db.js';
import { PRIORITY_XP, awardXp, revokeXp, syncRewards, levelInfo, totalXp } from '../domain/gamification.js';
import { summarizeDay } from '../domain/summary.js';
import { dayItems, loadTasks, serializeDayItem, serializeTask, type TaskRow } from '../domain/schedule.js';
import { HttpError, addDays, handler, isValidDate, notFound, parse, pct } from '../util.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
const date = z.string().refine(isValidDate, 'Use YYYY-MM-DD');

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  category: z.string().trim().min(1).max(30),
  scheduledTime: time.nullable(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable(),
  durationMin: z.number().int().min(1).max(1440).nullable(),
  priority: z.enum(['low', 'medium', 'high']),
  repeatType: z.enum(['none', 'daily', 'selected_days', 'weekly', 'custom']),
  repeatDays: z.array(z.number().int().min(0).max(6)).max(7),
  repeatInterval: z.number().int().min(1).max(365),
  startDate: date,
  endDate: date.nullable(),
  goalId: z.number().int().nullable(),
  isHabit: z.boolean(),
};

const createSchema = z.object(taskFields).partial().required({ title: true });
const updateSchema = z.object(taskFields).partial();

export const parseDate = (s: string): string => {
  if (!isValidDate(s)) throw new HttpError(400, 'Date must be a real YYYY-MM-DD date');
  return s;
};

function checkRules(t: { repeatType?: string; repeatDays?: number[]; scheduledTime?: string | null; reminderMinutes?: number | null; startDate?: string; endDate?: string | null }) {
  if (t.repeatType === 'selected_days' && !(t.repeatDays && t.repeatDays.length)) {
    throw new HttpError(400, 'Pick at least one day for a selected-days repeat');
  }
  if (t.reminderMinutes != null && !t.scheduledTime) throw new HttpError(400, 'A reminder needs a scheduled time');
  if (t.startDate && t.endDate && t.endDate < t.startDate) throw new HttpError(400, 'End date is before start date');
}

export function tasksRouter(db: DB): Router {
  const r = Router();

  const owned = (userId: number, demo: number, id: number): TaskRow => {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND demo = ?').get(id, userId, demo) as TaskRow | undefined;
    if (!row) throw notFound('Task');
    return row;
  };
  const checkGoal = (userId: number, demo: number, goalId: number | null | undefined) => {
    if (goalId == null) return;
    if (!db.prepare('SELECT 1 FROM goals WHERE id = ? AND user_id = ? AND demo = ?').get(goalId, userId, demo)) {
      throw new HttpError(400, 'That goal does not exist');
    }
  };

  r.get(
    '/tasks',
    handler((req, res) => {
      const { category, priority, goalId } = req.query;
      let tasks = loadTasks(db, req.user);
      if (typeof category === 'string') tasks = tasks.filter((t) => t.category === category);
      if (typeof priority === 'string') tasks = tasks.filter((t) => t.priority === priority);
      if (typeof goalId === 'string') tasks = tasks.filter((t) => String(t.goal_id) === goalId);
      res.json(tasks.map(serializeTask));
    }),
  );

  r.post(
    '/tasks',
    handler((req, res) => {
      const b = parse(createSchema, req.body);
      const u = req.user;
      const startDate = b.startDate ?? u.today;
      checkRules({ ...b, startDate });
      checkGoal(u.id, u.demo, b.goalId);
      const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE user_id = ? AND demo = ?').get(u.id, u.demo) as { m: number }).m;
      const info = db
        .prepare(
          `INSERT INTO tasks (user_id, title, description, category, scheduled_time, reminder_minutes, duration_min, priority,
             repeat_type, repeat_days, repeat_interval, start_date, end_date, goal_id, is_habit, sort_order, demo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          u.id, b.title, b.description ?? '', b.category ?? 'Personal', b.scheduledTime ?? null, b.reminderMinutes ?? null,
          b.durationMin ?? null, b.priority ?? 'medium', b.repeatType ?? 'none', JSON.stringify(b.repeatDays ?? []),
          b.repeatInterval ?? 1, startDate, b.endDate ?? null, b.goalId ?? null, b.isHabit ? 1 : 0, maxOrder + 1, u.demo,
        );
      res.status(201).json(serializeTask(owned(u.id, u.demo, Number(info.lastInsertRowid))));
    }),
  );

  r.post(
    '/tasks/reorder',
    handler((req, res) => {
      const { ids } = parse(z.object({ ids: z.array(z.number().int()).min(1).max(1000) }), req.body);
      const u = req.user;
      const tx = db.transaction(() => {
        ids.forEach((id, i) => {
          owned(u.id, u.demo, id);
          db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?').run(i + 1, id);
        });
      });
      tx();
      res.json({ ok: true });
    }),
  );

  r.get('/tasks/:id', handler((req, res) => res.json(serializeTask(owned(req.user.id, req.user.demo, Number(req.params.id))))));

  r.patch(
    '/tasks/:id',
    handler((req, res) => {
      const u = req.user;
      const cur = owned(u.id, u.demo, Number(req.params.id));
      const b = parse(updateSchema, req.body);
      const merged = {
        repeatType: b.repeatType ?? cur.repeat_type,
        repeatDays: b.repeatDays ?? (JSON.parse(cur.repeat_days) as number[]),
        scheduledTime: b.scheduledTime !== undefined ? b.scheduledTime : cur.scheduled_time,
        reminderMinutes: b.reminderMinutes !== undefined ? b.reminderMinutes : cur.reminder_minutes,
        startDate: b.startDate ?? cur.start_date,
        endDate: b.endDate !== undefined ? b.endDate : cur.end_date,
      };
      checkRules(merged);
      if (b.goalId !== undefined) checkGoal(u.id, u.demo, b.goalId);
      db.prepare(
        `UPDATE tasks SET title=?, description=?, category=?, scheduled_time=?, reminder_minutes=?, duration_min=?, priority=?,
           repeat_type=?, repeat_days=?, repeat_interval=?, start_date=?, end_date=?, goal_id=?, is_habit=? WHERE id=?`,
      ).run(
        b.title ?? cur.title, b.description ?? cur.description, b.category ?? cur.category, merged.scheduledTime,
        merged.reminderMinutes, b.durationMin !== undefined ? b.durationMin : cur.duration_min, b.priority ?? cur.priority,
        merged.repeatType, JSON.stringify(merged.repeatDays), b.repeatInterval ?? cur.repeat_interval, merged.startDate,
        merged.endDate, b.goalId !== undefined ? b.goalId : cur.goal_id, b.isHabit !== undefined ? (b.isHabit ? 1 : 0) : cur.is_habit, cur.id,
      );
      res.json(serializeTask(owned(u.id, u.demo, cur.id)));
    }),
  );

  /**
   * DELETE /tasks/:id            -> removes the task AND its history.
   * DELETE /tasks/:id?keepHistory=true -> stops it from recurring after today but keeps past records.
   */
  r.delete(
    '/tasks/:id',
    handler((req, res) => {
      const u = req.user;
      const t = owned(u.id, u.demo, Number(req.params.id));
      if (req.query.keepHistory === 'true') {
        const end = addDays(u.today, -1);
        if (end < t.start_date) db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
        else db.prepare('UPDATE tasks SET end_date = ? WHERE id = ?').run(end, t.id);
        return res.json({ ok: true, mode: 'ended' });
      }
      db.prepare("DELETE FROM xp_events WHERE user_id = ? AND demo = ? AND kind = 'task' AND ref LIKE ?").run(u.id, u.demo, `${t.id}:%`);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
      res.json({ ok: true, mode: 'deleted' });
    }),
  );

  // ----- a single day -----

  const daySummary = (u: AuthedUser, d: string) => summarizeDay(db, u, d);

  r.get(
    '/days/:date',
    handler((req, res) => {
      const d = parseDate(String(req.params.date));
      const items = dayItems(db, req.user, d);
      res.json({ date: d, summary: daySummary(req.user, d), tasks: items.map(serializeDayItem) });
    }),
  );

  /** Set a task's status for one date. `not_started` removes the log, which is how undo works. */
  r.put(
    '/days/:date/tasks/:taskId',
    handler((req, res) => {
      const u = req.user;
      const d = parseDate(String(req.params.date));
      const task = owned(u.id, u.demo, Number(req.params.taskId));
      const b = parse(z.object({ status: z.enum(['not_started', 'in_progress', 'completed', 'skipped']), note: z.string().max(500).optional() }), req.body);
      if (d > u.today && b.status === 'completed') throw new HttpError(400, 'You can’t complete a task in the future');

      const before = db.prepare('SELECT status FROM task_logs WHERE task_id = ? AND date = ?').get(task.id, d) as { status: string } | undefined;
      let xpGained = 0;
      db.transaction(() => {
        if (b.status === 'not_started') {
          db.prepare('DELETE FROM task_logs WHERE task_id = ? AND date = ?').run(task.id, d);
        } else {
          db.prepare(
            `INSERT INTO task_logs (user_id, task_id, date, status, completed_at, note, demo) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(task_id, date) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at,
               note = CASE WHEN ? IS NULL THEN task_logs.note ELSE excluded.note END`,
          ).run(u.id, task.id, d, b.status, b.status === 'completed' ? new Date().toISOString() : null, b.note ?? '', u.demo, b.note ?? null);
        }
        const ref = `${task.id}:${d}`;
        if (b.status === 'completed') xpGained = awardXp(db, u, 'task', ref, PRIORITY_XP[task.priority], d);
        else revokeXp(db, u, 'task', ref);
      })();

      const rewards = syncRewards(db, u);
      const summary = daySummary(u, d);
      res.json({
        date: d,
        taskId: task.id,
        previousStatus: before?.status ?? 'not_started',
        status: b.status,
        summary,
        rewards: { xpGained, ...rewards, totalXp: totalXp(db, u), ...levelInfo(totalXp(db, u)) },
        celebrate: b.status === 'completed',
        allDone: summary.allDone && b.status === 'completed',
      });
    }),
  );

  return r;
}
