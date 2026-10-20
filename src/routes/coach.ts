import { Router } from 'express';
import { z } from 'zod';
import type { AuthedUser } from '../auth.js';
import { config } from '../config.js';
import type { DB } from '../db.js';
import { levelInfo, totalXp } from '../domain/gamification.js';
import { growthReport } from '../domain/report.js';
import { dayItems, serializeDayItem, serializeTask, type DayItem } from '../domain/schedule.js';
import { computeStreaks } from '../domain/stats.js';
import { summarizeDay } from '../domain/summary.js';
import { HttpError, addDays, handler, parse, startOfWeek } from '../util.js';

const rank = { high: 0, medium: 1, low: 2 } as const;
const nextOpen = (items: DayItem[]) =>
  items
    .filter((i) => i.status === 'not_started' || i.status === 'in_progress')
    .sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || rank[a.task.priority] - rank[b.task.priority] || (a.task.scheduled_time ?? '99').localeCompare(b.task.scheduled_time ?? '99'))[0];

type BriefType = 'morning' | 'today' | 'next' | 'week' | 'evening' | 'reminders';

/** Plain-language messages, written to be spoken aloud as well as read. All numbers come from saved data. */
function briefing(db: DB, u: AuthedUser, type: BriefType): string {
  const items = dayItems(db, u, u.today);
  const s = summarizeDay(db, u, u.today);
  const next = nextOpen(items);
  switch (type) {
    case 'morning': {
      if (!s.planned) return `Good morning, ${u.name}! Nothing is planned yet. Let's plan a great day. Add one or two things that matter.`;
      const top = next ? ` Start with ${next.task.title}.` : '';
      return `Good morning, ${u.name}! You have ${s.planned} ${s.planned === 1 ? 'task' : 'tasks'} today.${top}`;
    }
    case 'today':
      if (!s.planned) return 'Nothing is planned for today yet.';
      if (s.allDone) return `You completed ${s.completed} out of ${s.planned} tasks. That's everything for today. Well done.`;
      return `You completed ${s.completed} out of ${s.planned} tasks. ${s.remaining} left${next ? `, and ${next.task.title} is a good next one` : ''}. You're making progress.`;
    case 'next':
      if (!s.planned) return 'You have nothing planned today. Want to add a task?';
      if (!next) return 'Everything planned for today is done or skipped. Enjoy the rest of your day.';
      return `Focus on ${next.task.title} next${next.task.scheduled_time ? `, scheduled for ${next.task.scheduled_time}` : ''}. Ready for your next session?`;
    case 'week': {
      const ws = startOfWeek(u.today, u.settings.weekStart);
      const r = growthReport(db, u, { from: ws, to: addDays(ws, 6) }, 'This week');
      if (!r.accomplished.tasksPlanned) return 'There isn’t enough tracked activity this week to summarize yet.';
      return `This week you completed ${r.accomplished.tasksCompleted} of ${r.accomplished.tasksPlanned} planned tasks. ${r.nextImprovement}`;
    }
    case 'evening': {
      const done = db.prepare('SELECT 1 FROM journal WHERE user_id = ? AND demo = ? AND date = ?').get(u.id, u.demo, u.today);
      return `${s.planned ? `You finished ${s.completed} of ${s.planned} tasks today. ` : ''}${done ? 'Your reflection is saved. Rest well.' : 'Take a minute to reflect: what went well today?'}`;
    }
    case 'reminders': {
      const up = items.filter((i) => (i.status === 'not_started' || i.status === 'in_progress') && i.task.scheduled_time).slice(0, 3);
      if (!up.length) return 'You have no timed tasks coming up.';
      return `Coming up: ${up.map((i) => `${i.task.title} at ${i.task.scheduled_time}`).join(', ')}.`;
    }
  }
}

function intentOf(msg: string): BriefType | 'help' {
  const m = msg.toLowerCase();
  if (/\b(focus|next|should i do|what now|start)\b/.test(m)) return 'next';
  if (/\b(week|weekly)\b/.test(m)) return 'week';
  if (/\b(remind|upcoming|schedule|coming up)\b/.test(m)) return 'reminders';
  if (/\b(evening|reflect|journal)\b/.test(m)) return 'evening';
  if (/\b(morning|plan)\b/.test(m)) return 'morning';
  if (/\b(today|summary|how did i|how am i|progress|tasks)\b/.test(m)) return 'today';
  return 'help';
}

async function askAi(db: DB, u: AuthedUser, message: string): Promise<string> {
  const items = dayItems(db, u, u.today);
  const ws = startOfWeek(u.today, u.settings.weekStart);
  const week = growthReport(db, u, { from: ws, to: addDays(ws, 6) }, 'This week');
  // Aggregates and task titles only. Journal text is never sent.
  const context = {
    date: u.today,
    today: summarizeDay(db, u, u.today),
    openTasks: items.filter((i) => i.status !== 'completed' && i.status !== 'skipped').map((i) => ({ title: i.task.title, priority: i.task.priority, time: i.task.scheduled_time })),
    week: { completed: week.accomplished.tasksCompleted, planned: week.accomplished.tasksPlanned, postponed: week.frequentlyPostponed.map((p) => p.title) },
    streak: computeStreaks(db, u),
    level: levelInfo(totalXp(db, u)).level,
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 400,
      system:
        'You are the coach inside a personal productivity app called LEVEL UP. Be warm, honest and brief (under 80 words). Use only the data provided; never invent numbers. A missed task is information, never a reason to shame. Do not encourage sacrificing sleep, health or rest to keep a streak.',
      messages: [{ role: 'user', content: `Data: ${JSON.stringify(context)}\n\nQuestion: ${message}` }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`AI service responded ${r.status}`);
  const body = (await r.json()) as { content?: { type: string; text?: string }[] };
  const text = body.content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) throw new Error('Empty AI response');
  return text;
}

// ---- quick add ("add read 10 pages at 6pm tomorrow high priority for 20 minutes") ----
export function parseQuickAdd(text: string, today: string) {
  let t = ` ${text.trim()} `;
  const take = (re: RegExp) => {
    const m = t.match(re);
    if (m) t = t.replace(re, ' ');
    return m;
  };
  let priority: 'low' | 'medium' | 'high' = 'medium';
  if (take(/\b(high priority|urgent|important)\b/i)) priority = 'high';
  else if (take(/\blow priority\b/i)) priority = 'low';

  let scheduledTime: string | null = null;
  const tm = take(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (tm) {
    let h = Number(tm[1]);
    const min = Number(tm[2] ?? 0);
    const ap = tm[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h <= 23 && min <= 59) scheduledTime = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  let durationMin: number | null = null;
  const dm = take(/\bfor\s+(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i);
  if (dm) durationMin = Math.min(1440, /^h/i.test(dm[2]) ? Number(dm[1]) * 60 : Number(dm[1]));
  let startDate = today;
  if (take(/\btomorrow\b/i)) startDate = addDays(today, 1);
  else take(/\btoday\b/i);
  const repeatType = take(/\b(every day|daily)\b/i) ? ('daily' as const) : ('none' as const);
  const title = t.replace(/^\s*(please\s+)?(add( a)?( new)?( task)?|remind me to|create( a)?( task)?)\s+/i, '').replace(/\s+/g, ' ').trim();
  return { title, priority, scheduledTime, durationMin, startDate, repeatType };
}

export function coachRouter(db: DB): Router {
  const r = Router();

  r.get('/coach/status', handler((req, res) =>
    res.json({
      aiConfigured: !!config.anthropicKey,
      aiAllowedByUser: req.user.settings.privacy.allowAiCoach,
      mode: config.anthropicKey && req.user.settings.privacy.allowAiCoach ? 'ai' : 'rules',
      note: config.anthropicKey ? 'AI coaching is available.' : 'No AI key is configured on the server, so the built-in rule-based coach is used.',
    }),
  ));

  r.get(
    '/coach/briefing',
    handler((req, res) => {
      const type = String(req.query.type ?? 'today') as BriefType;
      if (!['morning', 'today', 'next', 'week', 'evening', 'reminders'].includes(type)) throw new HttpError(400, 'type must be morning, today, next, week, evening or reminders');
      res.json({ type, text: briefing(db, req.user, type) });
    }),
  );

  r.post(
    '/coach/ask',
    handler(async (req, res) => {
      const u = req.user;
      const { message } = parse(z.object({ message: z.string().trim().min(1).max(500) }), req.body);
      const intent = intentOf(message);
      const rules = intent === 'help'
        ? 'I can summarize your day, tell you what to focus on next, read upcoming reminders, or review your week. Try “What should I focus on next?”'
        : briefing(db, u, intent);

      if (config.anthropicKey && u.settings.privacy.allowAiCoach) {
        try {
          return res.json({ reply: await askAi(db, u, message), source: 'ai', intent });
        } catch (e) {
          console.warn('AI coach unavailable, using rule-based reply:', (e as Error).message);
          return res.json({ reply: rules, source: 'rules', intent, aiUnavailable: true });
        }
      }
      res.json({ reply: rules, source: 'rules', intent });
    }),
  );

  /** Turn a short sentence (typed or dictated) into a task. */
  r.post(
    '/tasks/quick',
    handler((req, res) => {
      const u = req.user;
      const { text } = parse(z.object({ text: z.string().trim().min(2).max(300) }), req.body);
      const p = parseQuickAdd(text, u.today);
      if (!p.title) throw new HttpError(400, 'Couldn’t find a task name in that sentence');
      const order = (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM tasks WHERE user_id = ? AND demo = ?').get(u.id, u.demo) as { n: number }).n;
      const info = db
        .prepare('INSERT INTO tasks (user_id, title, scheduled_time, duration_min, priority, repeat_type, start_date, sort_order, demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(u.id, p.title.slice(0, 200), p.scheduledTime, p.durationMin, p.priority, p.repeatType, p.startDate, order, u.demo);
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(info.lastInsertRowid)) as never;
      res.status(201).json({ task: serializeTask(row), parsed: p });
    }),
  );

  void serializeDayItem;
  return r;
}
