import type { DB } from '../db.js';
import type { AuthedUser } from '../auth.js';
import { diffDays, weekday } from '../util.js';

export interface TaskRow {
  id: number;
  user_id: number;
  title: string;
  description: string;
  category: string;
  scheduled_time: string | null;
  reminder_minutes: number | null;
  duration_min: number | null;
  priority: 'low' | 'medium' | 'high';
  repeat_type: 'none' | 'daily' | 'selected_days' | 'weekly' | 'custom';
  repeat_days: string;
  repeat_interval: number;
  start_date: string;
  end_date: string | null;
  goal_id: number | null;
  is_habit: number;
  sort_order: number;
  demo: number;
}

export interface LogRow {
  id: number;
  task_id: number;
  date: string;
  status: 'in_progress' | 'completed' | 'skipped';
  completed_at: string | null;
  note: string;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

/** Does this task template land on `date`? Pure function of the template, never of saved logs. */
export function occursOn(t: TaskRow, date: string): boolean {
  if (date < t.start_date) return false;
  if (t.end_date && date > t.end_date) return false;
  switch (t.repeat_type) {
    case 'none':
      return date === t.start_date;
    case 'daily':
      return true;
    case 'weekly':
      return weekday(date) === weekday(t.start_date);
    case 'selected_days': {
      let days: number[] = [];
      try {
        days = JSON.parse(t.repeat_days) as number[];
      } catch {
        /* treated as no days */
      }
      return days.includes(weekday(date));
    }
    case 'custom':
      return diffDays(date, t.start_date) % Math.max(1, t.repeat_interval) === 0;
    default:
      return false;
  }
}

export function loadTasks(db: DB, user: AuthedUser): TaskRow[] {
  return db
    .prepare('SELECT * FROM tasks WHERE user_id = ? AND demo = ? ORDER BY sort_order, scheduled_time, id')
    .all(user.id, user.demo) as TaskRow[];
}

export function loadLogs(db: DB, user: AuthedUser, from: string, to: string): LogRow[] {
  return db
    .prepare('SELECT id, task_id, date, status, completed_at, note FROM task_logs WHERE user_id = ? AND demo = ? AND date BETWEEN ? AND ?')
    .all(user.id, user.demo, from, to) as LogRow[];
}

export interface DayItem {
  task: TaskRow;
  status: TaskStatus;
  logId: number | null;
  completedAt: string | null;
  note: string;
  overdue: boolean;
}

export function nowTimeIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
      new Date(),
    );
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}

/**
 * Everything on a single day's list: tasks scheduled by recurrence, plus any task that has a log
 * for that date (so history stays visible even if the template was later changed).
 */
export function dayItems(db: DB, user: AuthedUser, date: string): DayItem[] {
  const tasks = loadTasks(db, user);
  const logs = new Map(loadLogs(db, user, date, date).map((l) => [l.task_id, l]));
  const now = nowTimeIn(user.settings.timezone);
  const items: DayItem[] = [];
  for (const t of tasks) {
    const log = logs.get(t.id);
    if (!occursOn(t, date) && !log) continue;
    const status: TaskStatus = log ? log.status : 'not_started';
    const open = status === 'not_started' || status === 'in_progress';
    const overdue =
      open && ((date < user.today) || (date === user.today && !!t.scheduled_time && t.scheduled_time < now));
    items.push({
      task: t,
      status,
      logId: log?.id ?? null,
      completedAt: log?.completed_at ?? null,
      note: log?.note ?? '',
      overdue,
    });
  }
  return items;
}

export const serializeTask = (t: TaskRow) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  category: t.category,
  scheduledTime: t.scheduled_time,
  reminderMinutes: t.reminder_minutes,
  durationMin: t.duration_min,
  priority: t.priority,
  repeatType: t.repeat_type,
  repeatDays: JSON.parse(t.repeat_days || '[]') as number[],
  repeatInterval: t.repeat_interval,
  startDate: t.start_date,
  endDate: t.end_date,
  goalId: t.goal_id,
  isHabit: !!t.is_habit,
  sortOrder: t.sort_order,
});

export const serializeDayItem = (i: DayItem) => ({
  ...serializeTask(i.task),
  status: i.status,
  completedAt: i.completedAt,
  note: i.note,
  overdue: i.overdue,
});
