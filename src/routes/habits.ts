import { Router } from 'express';
import type { DB } from '../db.js';
import { loadLogs, loadTasks, occursOn, serializeTask, type LogRow, type TaskRow } from '../domain/schedule.js';
import { addDays, dateRange, handler, notFound, pct } from '../util.js';
import { parseDate } from './tasks.js';

type Mark = 'completed' | 'skipped' | 'missed' | 'pending' | 'not_scheduled';

function marks(t: TaskRow, logs: LogRow[], from: string, to: string, today: string) {
  const byDate = new Map(logs.filter((l) => l.task_id === t.id).map((l) => [l.date, l]));
  return dateRange(from, to).map((date) => {
    const l = byDate.get(date);
    let mark: Mark;
    if (!occursOn(t, date) && !l) mark = 'not_scheduled';
    else if (l?.status === 'completed') mark = 'completed';
    else if (l?.status === 'skipped') mark = 'skipped';
    else mark = date >= today ? 'pending' : 'missed';
    return { date, mark };
  });
}

/** Streak over scheduled occurrences: skipped and still-open days are neutral, only a past miss breaks it. */
function streaks(ms: { date: string; mark: Mark }[]) {
  let current = 0, best = 0;
  for (const m of ms) {
    if (m.mark === 'completed') { current++; best = Math.max(best, current); }
    else if (m.mark === 'missed') current = 0;
  }
  return { current, best };
}

export function habitsRouter(db: DB): Router {
  const r = Router();

  r.get(
    '/habits',
    handler((req, res) => {
      const u = req.user;
      const from = addDays(u.today, -400);
      const logs = loadLogs(db, u, from, u.today);
      const habits = loadTasks(db, u).filter((t) => t.is_habit);
      res.json(
        habits.map((t) => {
          const all = marks(t, logs, t.start_date > from ? t.start_date : from, u.today, u.today);
          const last30 = all.slice(-30).filter((m) => m.mark !== 'not_scheduled' && m.mark !== 'pending');
          const done = last30.filter((m) => m.mark === 'completed').length;
          const scheduled = last30.filter((m) => m.mark !== 'skipped').length;
          return {
            ...serializeTask(t),
            streak: streaks(all),
            last7Days: marks(t, logs, addDays(u.today, -6), u.today, u.today),
            last30Days: { scheduled, completed: done, skipped: last30.length - scheduled, completionPercent: pct(done, scheduled) },
          };
        }),
      );
    }),
  );

  r.get(
    '/habits/:id/history',
    handler((req, res) => {
      const u = req.user;
      const t = loadTasks(db, u).find((x) => x.id === Number(req.params.id));
      if (!t) throw notFound('Habit');
      const to = typeof req.query.to === 'string' ? parseDate(req.query.to) : u.today;
      const from = typeof req.query.from === 'string' ? parseDate(req.query.from) : addDays(to, -89);
      res.json({ habit: serializeTask(t), days: marks(t, loadLogs(db, u, from, to), from, to, u.today) });
    }),
  );

  return r;
}
