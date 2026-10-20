import type { AuthedUser } from '../auth.js';
import type { DB } from '../db.js';
import { addDays, diffDays, pct } from '../util.js';
import { buildCtx, byCategory, computeDays, taskConsistency, totals, type DayStat } from './stats.js';

export interface Period {
  from: string;
  to: string;
}

export const previousPeriod = (p: Period): Period => {
  const len = diffDays(p.to, p.from) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
};

export function periodStats(db: DB, user: AuthedUser, p: Period) {
  const ctx = buildCtx(db, user, p.from, p.to);
  const days = computeDays(ctx, user, p.from, p.to);
  return { ctx, days, totals: totals(days) };
}

function count(db: DB, sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { c: number }).c;
}

export function compare(cur: { completionPercent: number | null; daysWithData: number }, prev: { completionPercent: number | null; daysWithData: number }) {
  if (cur.completionPercent === null || prev.completionPercent === null || cur.daysWithData < 2 || prev.daysWithData < 2) {
    return { available: false as const, note: 'Not enough tracked days in both periods to compare fairly.' };
  }
  const delta = cur.completionPercent - prev.completionPercent;
  return {
    available: true as const,
    currentPercent: cur.completionPercent,
    previousPercent: prev.completionPercent,
    deltaPoints: delta,
    direction: delta > 0 ? ('up' as const) : delta < 0 ? ('down' as const) : ('same' as const),
  };
}

/**
 * The six-question growth report. Everything is computed from saved records; when a section has
 * nothing to report it says so instead of filling in a number.
 */
export function growthReport(db: DB, user: AuthedUser, p: Period, label: string) {
  const { ctx, days, totals: t } = periodStats(db, user, p);
  const prev = periodStats(db, user, previousPeriod(p));
  const U = [user.id, user.demo];

  const focus = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(actual_min), 0) AS mins FROM focus_sessions WHERE user_id = ? AND demo = ? AND completed = 1 AND date BETWEEN ? AND ?')
    .get(...U, p.from, p.to) as { n: number; mins: number };
  const goalsDone = db
    .prepare("SELECT title FROM goals WHERE user_id = ? AND demo = ? AND status = 'completed' AND substr(completed_at, 1, 10) BETWEEN ? AND ?")
    .all(...U, p.from, p.to) as { title: string }[];
  const milestonesDone = count(db, 'SELECT COUNT(*) c FROM milestones m JOIN goals g ON g.id = m.goal_id WHERE m.user_id = ? AND g.demo = ? AND m.done = 1 AND substr(m.done_at, 1, 10) BETWEEN ? AND ?', ...U, p.from, p.to);
  const minutesCompleted = days.reduce((s, d) => s + d.minutesCompleted, 0);

  const consistency = taskConsistency(ctx, days);
  const strongHabits = consistency.filter((c) => c.planned >= 3 && (c.completionPercent ?? 0) >= 80).sort((a, b) => (b.completionPercent ?? 0) - (a.completionPercent ?? 0) || b.planned - a.planned);
  const postponed = consistency.filter((c) => c.missed >= 2).sort((a, b) => b.missed - a.missed);

  const journal = db
    .prepare("SELECT date, difficult, distracted, learned, proud FROM journal WHERE user_id = ? AND demo = ? AND date BETWEEN ? AND ? ORDER BY date")
    .all(...U, p.from, p.to) as { date: string; difficult: string; distracted: string; learned: string; proud: string }[];
  const obstacles = journal.flatMap((j) => [
    ...(j.difficult.trim() ? [{ date: j.date, kind: 'difficult' as const, text: j.difficult.trim() }] : []),
    ...(j.distracted.trim() ? [{ date: j.date, kind: 'distracted' as const, text: j.distracted.trim() }] : []),
  ]);

  const comparison = compare(t, prev.totals);

  // One realistic next step, chosen by rule (not generated). Smallest sensible change first.
  let nextStep: string;
  if (t.daysWithData === 0) {
    nextStep = 'Add two or three small tasks you could finish today, then check one off. Small wins build the data this report needs.';
  } else if (postponed.length) {
    const w = postponed[0];
    nextStep = `“${w.title}” was left open ${w.missed} times. Try shrinking it to a 10-minute version or giving it a fixed time, and see if that makes it easier to start.`;
  } else if ((t.completionPercent ?? 0) < 50) {
    nextStep = 'You planned a lot relative to what fit. Try trimming tomorrow’s list to the three things that matter most.';
  } else if (!journal.length) {
    nextStep = 'Your task data looks steady. Add a two-line reflection at the end of the day so the review can also show what helped.';
  } else {
    nextStep = 'You’re keeping a steady rhythm. If you want a stretch, add one small habit and keep everything else the same.';
  }

  // Honest but supportive summary sentence.
  let summary: string;
  if (t.daysWithData === 0) summary = `There isn’t enough tracked activity in ${label} to summarize yet. That’s fine. Your first completed task starts the record.`;
  else {
    const base = `${label}: you completed ${t.completed} of ${t.planned} planned tasks (${t.completionPercent}%).`;
    const tone =
      (t.completionPercent ?? 0) >= 80 ? 'That’s a strong stretch.' : (t.completionPercent ?? 0) >= 50 ? 'There’s solid progress here, with room to make it smoother.' : 'It was a harder stretch. A low number is information about what to adjust, not a verdict on you.';
    summary = `${base} ${tone}`;
  }

  return {
    label,
    from: p.from,
    to: p.to,
    summary,
    dataQuality: { daysWithData: t.daysWithData, daysWithoutData: t.daysWithoutData, note: t.daysWithData === 0 ? 'No tracked days in this period.' : 'Days with nothing planned are left out, never counted as zero.' },
    accomplished: {
      tasksCompleted: t.completed,
      tasksPlanned: t.planned,
      tasksSkipped: t.skipped,
      completionPercent: t.completionPercent,
      minutesCompleted,
      focusSessions: focus.n,
      focusMinutes: focus.mins,
      goalsCompleted: goalsDone.map((g) => g.title),
      milestonesReached: milestonesDone,
    },
    improvedVsPrevious: comparison,
    consistentHabits: strongHabits.slice(0, 5).map((c) => ({ taskId: c.taskId, title: c.title, completed: c.completed, planned: c.planned, completionPercent: c.completionPercent })),
    frequentlyPostponed: postponed.slice(0, 5).map((c) => ({ taskId: c.taskId, title: c.title, missed: c.missed, planned: c.planned })),
    obstacles: { daysReported: new Set(obstacles.map((o) => o.date)).size, entries: obstacles.slice(-10) },
    nextImprovement: nextStep,
    lessonsLearned: journal.filter((j) => j.learned.trim()).map((j) => ({ date: j.date, text: j.learned.trim() })).slice(-7),
    byCategory: byCategory(ctx, days),
  };
}

export type { DayStat };
export { pct };
