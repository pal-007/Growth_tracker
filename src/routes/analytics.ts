import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { ACHIEVEMENTS, levelInfo, totalXp } from '../domain/gamification.js';
import { growthReport, periodStats, previousPeriod, compare } from '../domain/report.js';
import { dayItems, nowTimeIn, serializeDayItem } from '../domain/schedule.js';
import { byCategory, byWeekday, computeStreaks, taskConsistency, totals, type DayStat } from '../domain/stats.js';
import { summarizeDay } from '../domain/summary.js';
import { HttpError, addDays, handler, isValidDate, parse, pct, startOfWeek } from '../util.js';
import { parseDate } from './tasks.js';

const QUOTES = [
  'Small steps every day add up to big changes.',
  'Progress, not perfection.',
  'You don’t have to be extreme, just consistent.',
  'Start where you are. Use what you have. Do what you can.',
  'A slow day still moves you forward.',
  'Done is better than perfect.',
  'Show up today. Tomorrow’s you will say thanks.',
  'Rest is part of the plan, not a break from it.',
  'One focused hour beats a distracted day.',
  'Every level starts with a single task.',
  'Be proud of the effort, not just the outcome.',
  'Missing a day is data. Coming back is the skill.',
  'Make it small enough that you can’t say no.',
  'Today’s routine is tomorrow’s ease.',
];
const quoteFor = (date: string) => QUOTES[Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000) % QUOTES.length];

function greeting(tz: string, name: string): string {
  const h = Number(nowTimeIn(tz).slice(0, 2));
  const part = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good evening';
  return `${part}, ${name}`;
}

const groupBy = (days: DayStat[], key: (d: string) => string) => {
  const m = new Map<string, DayStat[]>();
  for (const d of days) {
    const k = key(d.date);
    m.set(k, [...(m.get(k) ?? []), d]);
  }
  return [...m.entries()].map(([k, ds]) => ({ key: k, ...totals(ds) }));
};

export function analyticsRouter(db: DB): Router {
  const r = Router();

  r.get(
    '/dashboard',
    handler((req, res) => {
      const u = req.user;
      const items = dayItems(db, u, u.today);
      const now = nowTimeIn(u.settings.timezone);
      const open = items.filter((i) => i.status === 'not_started' || i.status === 'in_progress');
      const rank = { high: 0, medium: 1, low: 2 } as const;
      const weekStart = startOfWeek(u.today, u.settings.weekStart);
      const weekDone = (db.prepare("SELECT COUNT(*) AS c FROM task_logs WHERE user_id = ? AND demo = ? AND status = 'completed' AND date BETWEEN ? AND ?").get(u.id, u.demo, weekStart, addDays(weekStart, 6)) as { c: number }).c;
      const goalsDone = (db.prepare("SELECT COUNT(*) AS c FROM goals WHERE user_id = ? AND demo = ? AND status = 'completed'").get(u.id, u.demo) as { c: number }).c;
      const reflected = !!db.prepare('SELECT 1 FROM journal WHERE user_id = ? AND demo = ? AND date = ?').get(u.id, u.demo, u.today);
      const streak = computeStreaks(db, u);
      const lvl = levelInfo(totalXp(db, u));

      res.json({
        demoMode: !!u.demo,
        date: u.today,
        greeting: greeting(u.settings.timezone, u.name),
        today: summarizeDay(db, u, u.today),
        topPriorities: [...open].sort((a, b) => rank[a.task.priority] - rank[b.task.priority] || (a.task.scheduled_time ?? '99').localeCompare(b.task.scheduled_time ?? '99')).slice(0, 3).map(serializeDayItem),
        upcoming: open.filter((i) => i.task.scheduled_time && i.task.scheduled_time >= now).map(serializeDayItem),
        overdue: open.filter((i) => i.overdue).map(serializeDayItem),
        timeline: [...items].sort((a, b) => (a.task.scheduled_time ?? '99:99').localeCompare(b.task.scheduled_time ?? '99:99')).map(serializeDayItem),
        streak,
        weeklyProgress: { weekStart, completed: weekDone, target: u.settings.weeklyTargetTasks, percent: Math.min(100, Math.round((weekDone / u.settings.weeklyTargetTasks) * 100)) },
        goalsAchieved: goalsDone,
        level: lvl,
        quote: quoteFor(u.today),
        reflection: { done: reflected, prompt: 'How was your day?' },
      });
    }),
  );

  r.get(
    '/analytics',
    handler((req, res) => {
      const u = req.user;
      const to = typeof req.query.to === 'string' ? parseDate(req.query.to) : u.today;
      const from = typeof req.query.from === 'string' ? parseDate(req.query.from) : addDays(to, -29);
      if (from > to) throw new HttpError(400, '`from` is after `to`');
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 365) throw new HttpError(400, 'Range is limited to 366 days');

      const cur = periodStats(db, u, { from, to });
      const prevP = previousPeriod({ from, to });
      const prev = periodStats(db, u, prevP);
      const cons = taskConsistency(cur.ctx, cur.days);
      const weekdays = byWeekday(cur.days);
      const rated = weekdays.filter((w) => w.daysWithData >= 2 && w.completionPercent !== null);
      const best = [...rated].sort((a, b) => (b.completionPercent ?? 0) - (a.completionPercent ?? 0))[0] ?? null;
      const hardest = [...rated].sort((a, b) => (a.completionPercent ?? 0) - (b.completionPercent ?? 0))[0] ?? null;

      const goals = db.prepare('SELECT status FROM goals WHERE user_id = ? AND demo = ?').all(u.id, u.demo) as { status: string }[];
      const goalCount = (s: string) => goals.filter((g) => g.status === s).length;
      const difficulties = db
        .prepare("SELECT date, difficult, distracted FROM journal WHERE user_id = ? AND demo = ? AND date BETWEEN ? AND ? AND (trim(difficult) != '' OR trim(distracted) != '') ORDER BY date DESC LIMIT 10")
        .all(u.id, u.demo, from, to) as { date: string; difficult: string; distracted: string }[];

      const unlocked = db.prepare('SELECT key, date FROM achievements WHERE user_id = ? AND demo = ? ORDER BY date').all(u.id, u.demo) as { key: string; date: string }[];

      res.json({
        range: { from, to },
        // Daily series doubles as the calendar/heatmap source. completionPercent is null (not 0) when there's no data.
        days: cur.days,
        totals: cur.totals,
        previousPeriod: { range: prevP, totals: prev.totals },
        comparison: compare(cur.totals, prev.totals),
        weekly: groupBy(cur.days, (d) => startOfWeek(d, u.settings.weekStart)).map((w) => ({ weekStart: w.key, ...w, key: undefined })),
        monthly: groupBy(cur.days, (d) => d.slice(0, 7)).map((m) => ({ month: m.key, ...m, key: undefined })),
        byCategory: byCategory(cur.ctx, cur.days),
        timeByCategoryMinutes: byCategory(cur.ctx, cur.days).map((c) => ({ category: c.category, minutes: c.minutesCompleted })),
        byWeekday: weekdays,
        bestDay: best,
        hardestDay: hardest,
        mostConsistent: cons.filter((c) => c.planned >= 3).sort((a, b) => (b.completionPercent ?? 0) - (a.completionPercent ?? 0) || b.planned - a.planned).slice(0, 5),
        frequentlyMissed: cons.filter((c) => c.missed >= 2).sort((a, b) => b.missed - a.missed).slice(0, 5),
        goals: {
          total: goals.length,
          completed: goalCount('completed'),
          inProgress: goalCount('in_progress'),
          paused: goalCount('paused'),
          notStarted: goalCount('not_started'),
          completionRatePercent: pct(goalCount('completed'), goals.length),
        },
        streak: computeStreaks(db, u),
        milestonesAchieved: unlocked.map((a) => ({ date: a.date, key: a.key, name: ACHIEVEMENTS.find((x) => x.key === a.key)?.name ?? a.key })),
        commonDifficulties: difficulties,
        notes: [
          'completionPercent is null on days with nothing planned, before you started tracking, or in the future.',
          'Skipped tasks are counted separately from missed ones.',
        ],
      });
    }),
  );

  r.get(
    '/reports/daily',
    handler((req, res) => {
      const u = req.user;
      const d = typeof req.query.date === 'string' ? parseDate(req.query.date) : u.today;
      res.json(growthReport(db, u, { from: d, to: d }, d === u.today ? 'Today' : d));
    }),
  );

  r.get(
    '/reports/weekly',
    handler((req, res) => {
      const u = req.user;
      const start = typeof req.query.weekStart === 'string' ? parseDate(req.query.weekStart) : startOfWeek(u.today, u.settings.weekStart);
      res.json(growthReport(db, u, { from: start, to: addDays(start, 6) }, start === startOfWeek(u.today, u.settings.weekStart) ? 'This week' : `Week of ${start}`));
    }),
  );

  // ----- weekly review -----

  r.get(
    '/review/weekly',
    handler((req, res) => {
      const u = req.user;
      const start = typeof req.query.weekStart === 'string' ? parseDate(req.query.weekStart) : startOfWeek(u.today, u.settings.weekStart);
      const end = addDays(start, 6);
      const label = start === startOfWeek(u.today, u.settings.weekStart) ? 'This week' : `Week of ${start}`;
      const report = growthReport(db, u, { from: start, to: end }, label);
      const { days } = periodStats(db, u, { from: start, to: end });

      const goals = db.prepare("SELECT id, title, status, priority, target_value, current_value FROM goals WHERE user_id = ? AND demo = ? AND status IN ('in_progress','not_started','paused') ORDER BY id").all(u.id, u.demo) as {
        id: number; title: string; status: string; priority: string; target_value: number | null; current_value: number;
      }[];
      const done = (db.prepare('SELECT goal_id, COUNT(*) AS c, SUM(done) AS d FROM milestones WHERE user_id = ? GROUP BY goal_id').all(u.id) as { goal_id: number; c: number; d: number }[]);
      const goalProgress = goals.map((g) => {
        const m = done.find((x) => x.goal_id === g.id);
        const percent = m ? pct(m.d, m.c) : g.target_value ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : null;
        return { id: g.id, title: g.title, status: g.status, progressPercent: percent };
      });

      // "Most meaningful" is a transparent rule: a completed goal beats a milestone, which beats an unlocked
      // achievement, which beats the highest-priority longest task. The person can always overrule it.
      const goalWin = db.prepare("SELECT title FROM goals WHERE user_id = ? AND demo = ? AND status = 'completed' AND substr(completed_at,1,10) BETWEEN ? AND ? ORDER BY completed_at DESC LIMIT 1").get(u.id, u.demo, start, end) as { title: string } | undefined;
      const msWin = db.prepare('SELECT m.title FROM milestones m JOIN goals g ON g.id = m.goal_id WHERE m.user_id = ? AND g.demo = ? AND m.done = 1 AND substr(m.done_at,1,10) BETWEEN ? AND ? ORDER BY m.done_at DESC LIMIT 1').get(u.id, u.demo, start, end) as { title: string } | undefined;
      const achWin = db.prepare('SELECT key FROM achievements WHERE user_id = ? AND demo = ? AND date BETWEEN ? AND ? ORDER BY date DESC LIMIT 1').get(u.id, u.demo, start, end) as { key: string } | undefined;
      const taskWin = db.prepare(
        `SELECT t.title FROM task_logs l JOIN tasks t ON t.id = l.task_id WHERE l.user_id = ? AND l.demo = ? AND l.status = 'completed' AND l.date BETWEEN ? AND ?
         ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, COALESCE(t.duration_min, 0) DESC LIMIT 1`,
      ).get(u.id, u.demo, start, end) as { title: string } | undefined;
      const meaningful = goalWin ? { type: 'goal', title: `Completed goal: ${goalWin.title}` }
        : msWin ? { type: 'milestone', title: `Reached milestone: ${msWin.title}` }
        : achWin ? { type: 'achievement', title: `Unlocked ${ACHIEVEMENTS.find((a) => a.key === achWin.key)?.name ?? achWin.key}` }
        : taskWin ? { type: 'task', title: `Completed: ${taskWin.title}` } : null;

      res.json({
        weekStart: start,
        weekEnd: end,
        report,
        plannedVsCompleted: days.map((d) => ({ date: d.date, planned: d.planned, completed: d.completed, skipped: d.skipped, completionPercent: d.completionPercent, hasData: d.hasData })),
        goalProgress,
        mostMeaningfulAchievement: meaningful,
        reflections: report.lessonsLearned,
        nextWeek: { weekStart: addDays(start, 7), prompt: 'Pick up to three priorities for next week. We’ll add them to your plan.' },
      });
    }),
  );

  /** Turn up to three chosen priorities into scheduled tasks for next week. */
  r.post(
    '/review/weekly/priorities',
    handler((req, res) => {
      const u = req.user;
      const b = parse(
        z.object({
          weekStart: z.string().refine(isValidDate).optional(), // the week being planned; defaults to next week
          priorities: z
            .array(
              z.object({
                title: z.string().trim().min(1).max(200),
                category: z.string().trim().min(1).max(30).optional(),
                date: z.string().refine(isValidDate).optional(),
                scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
                durationMin: z.number().int().min(1).max(1440).nullable().optional(),
                goalId: z.number().int().nullable().optional(),
              }),
            )
            .min(1)
            .max(3),
        }),
        req.body,
      );
      const next = b.weekStart ?? addDays(startOfWeek(u.today, u.settings.weekStart), 7);
      const created = db.transaction(() =>
        b.priorities.map((p, i) => {
          const date = p.date ?? addDays(next, i * 2); // spread across the week unless a date is chosen
          if (p.goalId != null && !db.prepare('SELECT 1 FROM goals WHERE id = ? AND user_id = ? AND demo = ?').get(p.goalId, u.id, u.demo)) throw new HttpError(400, 'That goal does not exist');
          const order = (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM tasks WHERE user_id = ? AND demo = ?').get(u.id, u.demo) as { n: number }).n;
          const info = db.prepare(
            `INSERT INTO tasks (user_id, title, category, scheduled_time, duration_min, priority, repeat_type, start_date, goal_id, sort_order, demo)
             VALUES (?, ?, ?, ?, ?, 'high', 'none', ?, ?, ?, ?)`,
          ).run(u.id, p.title, p.category ?? 'Personal', p.scheduledTime ?? null, p.durationMin ?? null, date, p.goalId ?? null, order, u.demo);
          return { id: Number(info.lastInsertRowid), title: p.title, date };
        }),
      )();
      res.status(201).json({ weekStart: next, created });
    }),
  );

  return r;
}
