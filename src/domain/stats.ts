import type { AuthedUser } from '../auth.js';
import type { DB } from '../db.js';
import { addDays, dateRange, pct, round1, weekday } from '../util.js';
import { loadLogs, loadTasks, occursOn, type LogRow, type TaskRow } from './schedule.js';

export interface DayStat {
  date: string;
  planned: number;
  completed: number;
  skipped: number;
  inProgress: number;
  /** planned tasks nobody has marked completed/skipped/in progress */
  unresolved: number;
  completionPercent: number | null;
  /** false = not enough data to say anything (nothing planned, before tracking began, or in the future) */
  hasData: boolean;
  future: boolean;
  minutesPlanned: number;
  minutesCompleted: number;
}

/** First date the user recorded anything (a task log or journal entry). Earlier days have no data. */
export function trackingStart(db: DB, user: AuthedUser): string | null {
  const a = db.prepare('SELECT MIN(date) AS d FROM task_logs WHERE user_id = ? AND demo = ?').get(user.id, user.demo) as { d: string | null };
  const b = db.prepare('SELECT MIN(date) AS d FROM journal WHERE user_id = ? AND demo = ?').get(user.id, user.demo) as { d: string | null };
  const c = db.prepare('SELECT MIN(date) AS d FROM focus_sessions WHERE user_id = ? AND demo = ?').get(user.id, user.demo) as { d: string | null };
  const all = [a.d, b.d, c.d].filter((x): x is string => !!x).sort();
  return all[0] ?? null;
}

export interface Ctx {
  tasks: TaskRow[];
  logs: LogRow[];
  start: string | null;
}

export function buildCtx(db: DB, user: AuthedUser, from: string, to: string): Ctx {
  return { tasks: loadTasks(db, user), logs: loadLogs(db, user, from, to), start: trackingStart(db, user) };
}

export function computeDays(ctx: Ctx, user: AuthedUser, from: string, to: string): DayStat[] {
  const logsByDate = new Map<string, LogRow[]>();
  for (const l of ctx.logs) {
    const arr = logsByDate.get(l.date) ?? [];
    arr.push(l);
    logsByDate.set(l.date, arr);
  }
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));

  return dateRange(from, to).map((date) => {
    const logs = logsByDate.get(date) ?? [];
    const logged = new Map(logs.map((l) => [l.task_id, l]));
    const plannedTasks = ctx.tasks.filter((t) => occursOn(t, date) || logged.has(t.id));
    let completed = 0;
    let skipped = 0;
    let inProgress = 0;
    let minutesPlanned = 0;
    let minutesCompleted = 0;
    for (const t of plannedTasks) {
      const l = logged.get(t.id);
      minutesPlanned += t.duration_min ?? 0;
      if (l?.status === 'completed') {
        completed++;
        minutesCompleted += t.duration_min ?? 0;
      } else if (l?.status === 'skipped') skipped++;
      else if (l?.status === 'in_progress') inProgress++;
    }
    void taskById;
    const planned = plannedTasks.length;
    const future = date > user.today;
    const hasData = planned > 0 && !future && ctx.start !== null && date >= ctx.start;
    return {
      date,
      planned,
      completed,
      skipped,
      inProgress,
      unresolved: planned - completed - skipped - inProgress,
      completionPercent: hasData ? pct(completed, planned) : null,
      hasData,
      future,
      minutesPlanned,
      minutesCompleted,
    };
  });
}

export function totals(days: DayStat[]) {
  const d = days.filter((x) => x.hasData);
  const planned = d.reduce((s, x) => s + x.planned, 0);
  const completed = d.reduce((s, x) => s + x.completed, 0);
  const skipped = d.reduce((s, x) => s + x.skipped, 0);
  return {
    daysWithData: d.length,
    daysWithoutData: days.filter((x) => !x.hasData && !x.future).length,
    planned,
    completed,
    skipped,
    unresolved: d.reduce((s, x) => s + x.unresolved, 0),
    completionPercent: pct(completed, planned),
  };
}

/**
 * Streaks. A day counts when you completed at least `dailyTargetPercent` of what was planned.
 * Days with nothing planned don't break a streak. A day where everything left undone was
 * deliberately skipped is treated as a rest day: it neither extends nor breaks the streak.
 * Today never breaks a streak while it is still open.
 */
export function computeStreaks(db: DB, user: AuthedUser) {
  const start = trackingStart(db, user);
  if (!start) return { current: 0, best: 0, lastActiveDate: null as string | null };
  const from = start < addDays(user.today, -400) ? addDays(user.today, -400) : start;
  const ctx = buildCtx(db, user, from, user.today);
  const days = computeDays(ctx, user, from, user.today);
  const target = user.settings.dailyTargetPercent;

  type Kind = 'hit' | 'neutral' | 'miss';
  const kinds: { date: string; kind: Kind }[] = days.map((d) => {
    if (!d.hasData) return { date: d.date, kind: 'neutral' };
    const need = Math.max(1, Math.ceil((d.planned * target) / 100));
    if (d.completed >= need) return { date: d.date, kind: 'hit' };
    if (d.completed === 0 && d.skipped === d.planned) return { date: d.date, kind: 'neutral' };
    return { date: d.date, kind: d.date === user.today ? 'neutral' : 'miss' };
  });

  let best = 0;
  let run = 0;
  let lastActive: string | null = null;
  for (const k of kinds) {
    if (k.kind === 'hit') {
      run++;
      best = Math.max(best, run);
      lastActive = k.date;
    } else if (k.kind === 'miss') run = 0;
  }
  return { current: run, best, lastActiveDate: lastActive };
}

export function taskConsistency(ctx: Ctx, days: DayStat[]) {
  const valid = new Set(days.filter((d) => d.hasData).map((d) => d.date));
  const logMap = new Map<string, LogRow>();
  for (const l of ctx.logs) logMap.set(`${l.task_id}|${l.date}`, l);
  return ctx.tasks
    .map((t) => {
      let planned = 0;
      let completed = 0;
      let skipped = 0;
      let missed = 0;
      for (const date of valid) {
        const l = logMap.get(`${t.id}|${date}`);
        if (!occursOn(t, date) && !l) continue;
        planned++;
        if (l?.status === 'completed') completed++;
        else if (l?.status === 'skipped') skipped++;
        else missed++;
      }
      return {
        taskId: t.id,
        title: t.title,
        category: t.category,
        isHabit: !!t.is_habit,
        planned,
        completed,
        skipped,
        missed,
        completionPercent: pct(completed, planned),
      };
    })
    .filter((x) => x.planned > 0);
}

export function byCategory(ctx: Ctx, days: DayStat[]) {
  const valid = new Set(days.filter((d) => d.hasData).map((d) => d.date));
  const logMap = new Map<string, LogRow>();
  for (const l of ctx.logs) logMap.set(`${l.task_id}|${l.date}`, l);
  const acc = new Map<string, { planned: number; completed: number; minutesCompleted: number }>();
  for (const t of ctx.tasks) {
    for (const date of valid) {
      const l = logMap.get(`${t.id}|${date}`);
      if (!occursOn(t, date) && !l) continue;
      const row = acc.get(t.category) ?? { planned: 0, completed: 0, minutesCompleted: 0 };
      row.planned++;
      if (l?.status === 'completed') {
        row.completed++;
        row.minutesCompleted += t.duration_min ?? 0;
      }
      acc.set(t.category, row);
    }
  }
  return [...acc.entries()]
    .map(([category, v]) => ({ category, ...v, completionPercent: pct(v.completed, v.planned) }))
    .sort((a, b) => b.minutesCompleted - a.minutesCompleted || b.completed - a.completed);
}

export function byWeekday(days: DayStat[]) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names.map((name, i) => {
    const ds = days.filter((d) => d.hasData && weekday(d.date) === i);
    const planned = ds.reduce((s, d) => s + d.planned, 0);
    const completed = ds.reduce((s, d) => s + d.completed, 0);
    return { weekday: i, name, daysWithData: ds.length, planned, completed, completionPercent: pct(completed, planned) };
  });
}

export const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
