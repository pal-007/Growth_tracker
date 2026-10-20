import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { addDays } from '../src/util.js';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function register(email: string) {
  const r = await call('POST', '/api/auth/register', undefined, { email, password: 'password123', name: 'Asha' });
  assert.equal(r.status, 201);
  const me = await call('GET', '/api/me', r.json.token);
  return { token: r.json.token as string, today: me.json.today as string };
}

before(async () => {
  const app = createApp(openDb(':memory:'));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

describe('auth', () => {
  it('rejects missing/invalid tokens and duplicate emails', async () => {
    assert.equal((await call('GET', '/api/tasks')).status, 401);
    assert.equal((await call('GET', '/api/tasks', 'nope')).status, 401);
    await register('dup@example.com');
    const again = await call('POST', '/api/auth/register', undefined, { email: 'dup@example.com', password: 'password123', name: 'x' });
    assert.equal(again.status, 409);
    const bad = await call('POST', '/api/auth/login', undefined, { email: 'dup@example.com', password: 'wrong-pass' });
    assert.equal(bad.status, 401);
  });
});

describe('tasks, checkbox, recurrence and XP', () => {
  it('completes, undoes, and keeps history for recurring tasks', async () => {
    const { token, today } = await register('tasks@example.com');
    const yesterday = addDays(today, -1);

    const created = await call('POST', '/api/tasks', token, { title: 'Read 10 pages', category: 'Study', repeatType: 'daily', startDate: addDays(today, -3), priority: 'high', durationMin: 20 });
    assert.equal(created.status, 201);
    const id = created.json.id;

    // recurring task shows on every day since it started
    const yDay = await call('GET', `/api/days/${yesterday}`, token);
    assert.equal(yDay.json.tasks.length, 1);

    // complete yesterday, then today still starts fresh
    await call('PUT', `/api/days/${yesterday}/tasks/${id}`, token, { status: 'completed' });
    const tDay = await call('GET', `/api/days/${today}`, token);
    assert.equal(tDay.json.tasks[0].status, 'not_started');
    assert.equal((await call('GET', `/api/days/${yesterday}`, token)).json.tasks[0].status, 'completed');

    // check off today: percent, celebration, XP, first achievement
    const done = await call('PUT', `/api/days/${today}/tasks/${id}`, token, { status: 'completed' });
    assert.equal(done.status, 200);
    assert.equal(done.json.celebrate, true);
    assert.equal(done.json.allDone, true);
    assert.equal(done.json.summary.completionPercent, 100);
    assert.equal(done.json.rewards.xpGained, 20); // high priority
    const prof = await call('GET', '/api/gamification/profile', token);
    assert.ok(prof.json.achievements.find((a: any) => a.key === 'first_step').unlocked); // earned by yesterday's completion

    // idempotent: completing again doesn't double-count
    const again = await call('PUT', `/api/days/${today}/tasks/${id}`, token, { status: 'completed' });
    assert.equal(again.json.rewards.xpGained, 0);

    // undo
    const xpBefore = (await call('GET', '/api/gamification/profile', token)).json.xp;
    const undo = await call('PUT', `/api/days/${today}/tasks/${id}`, token, { status: 'not_started' });
    assert.equal(undo.json.summary.completionPercent, 0);
    const xpAfter = (await call('GET', '/api/gamification/profile', token)).json.xp;
    assert.ok(xpAfter < xpBefore);

    // can't complete the future; bad input is a 400
    assert.equal((await call('PUT', `/api/days/${addDays(today, 2)}/tasks/${id}`, token, { status: 'completed' })).status, 400);
    assert.equal((await call('POST', '/api/tasks', token, { title: '' })).status, 400);
    assert.equal((await call('POST', '/api/tasks', token, { title: 'x', repeatType: 'selected_days', repeatDays: [] })).status, 400);
    assert.equal((await call('GET', '/api/days/2026-02-31', token)).status, 400);
  });

  it('keeps one user’s data invisible to another', async () => {
    const a = await register('a@example.com');
    const b = await register('b@example.com');
    const t = await call('POST', '/api/tasks', a.token, { title: 'Private' });
    assert.equal((await call('GET', `/api/tasks/${t.json.id}`, b.token)).status, 404);
    assert.equal((await call('GET', '/api/tasks', b.token)).json.length, 0);
  });

  it('can end a task but keep its history', async () => {
    const { token, today } = await register('hist@example.com');
    const t = await call('POST', '/api/tasks', token, { title: 'Stretch', repeatType: 'daily', startDate: addDays(today, -2) });
    await call('PUT', `/api/days/${addDays(today, -1)}/tasks/${t.json.id}`, token, { status: 'completed' });
    await call('DELETE', `/api/tasks/${t.json.id}?keepHistory=true`, token);
    assert.equal((await call('GET', `/api/days/${today}`, token)).json.tasks.length, 0);
    assert.equal((await call('GET', `/api/days/${addDays(today, -1)}`, token)).json.tasks.length, 1);
  });
});

describe('goals, journal, focus', () => {
  it('tracks milestones and rewards completion', async () => {
    const { token } = await register('goals@example.com');
    const g = await call('POST', '/api/goals', token, { title: 'Finish course', milestones: [{ title: 'Part 1' }, { title: 'Part 2' }] });
    assert.equal(g.status, 201);
    assert.equal(g.json.progressPercent, 0);
    const m = await call('PATCH', `/api/goals/${g.json.id}/milestones/${g.json.milestones[0].id}`, token, { done: true });
    assert.equal(m.json.goal.progressPercent, 50);
    const done = await call('PATCH', `/api/goals/${g.json.id}`, token, { status: 'completed' });
    assert.equal(done.json.celebrate, true);
    assert.equal(done.json.goal.progressPercent, 100);
    const prof = await call('GET', '/api/gamification/profile', token);
    assert.ok(prof.json.achievements.find((a: any) => a.key === 'goal_crusher').unlocked);
  });

  it('saves reflections and refuses to invent mood patterns from thin data', async () => {
    const { token, today } = await register('journal@example.com');
    const put = await call('PUT', `/api/journal/${today}`, token, { wentWell: 'Shipped it', mood: 4, energy: 3 });
    assert.equal(put.status, 200);
    assert.equal(put.json.entry.moodLabel, 'good');
    assert.equal((await call('GET', `/api/journal/${today}`, token)).json.wentWell, 'Shipped it');
    const ins = await call('GET', '/api/journal/insights/mood', token);
    assert.equal(ins.json.enoughData, false);
    assert.equal((await call('PUT', `/api/journal/${addDays(today, 1)}`, token, { notes: 'x' })).status, 400);
  });

  it('records focus sessions and only rewards finished ones', async () => {
    const { token } = await register('focus@example.com');
    const quit = await call('POST', '/api/focus/sessions', token, { workMin: 25, actualMin: 3, completed: true });
    assert.equal(quit.json.session.completed, false); // 3 of 25 minutes is not a completed session
    const ok = await call('POST', '/api/focus/sessions', token, { workMin: 25, actualMin: 25, completed: true });
    assert.equal(ok.json.session.completed, true);
    const prof = await call('GET', '/api/gamification/profile', token);
    assert.ok(prof.json.achievements.find((a: any) => a.key === 'focus_master').unlocked);
  });
});

describe('analytics never invent data', () => {
  it('uses null, not zero, when there is nothing to measure', async () => {
    const { token, today } = await register('stats@example.com');
    const empty = await call('GET', '/api/analytics', token);
    assert.equal(empty.status, 200);
    assert.equal(empty.json.totals.completionPercent, null);
    assert.ok(empty.json.days.every((d: any) => d.completionPercent === null && d.hasData === false));
    assert.equal(empty.json.comparison.available, false);

    const t = await call('POST', '/api/tasks', token, { title: 'Run', category: 'Fitness', repeatType: 'daily', startDate: addDays(today, -6), durationMin: 30, isHabit: true });
    const t2 = await call('POST', '/api/tasks', token, { title: 'Write', category: 'Study', repeatType: 'daily', startDate: addDays(today, -6), durationMin: 15 });
    for (let i = 5; i >= 1; i--) {
      await call('PUT', `/api/days/${addDays(today, -i)}/tasks/${t.json.id}`, token, { status: 'completed' });
      if (i % 2) await call('PUT', `/api/days/${addDays(today, -i)}/tasks/${t2.json.id}`, token, { status: 'skipped' });
    }
    const a = await call('GET', '/api/analytics', token);
    const withData = a.json.days.filter((d: any) => d.hasData);
    assert.equal(withData.length, 6); // 5 logged days + today; days before tracking began stay "no data"
    assert.ok(a.json.days.some((d: any) => d.date === addDays(today, -6) && d.hasData === false));
    assert.ok(a.json.totals.skipped >= 3);
    assert.equal(a.json.byCategory.find((c: any) => c.category === 'Fitness').completed, 5);
    assert.ok(a.json.streak.current >= 5);

    const habits = await call('GET', '/api/habits', token);
    assert.equal(habits.json.length, 1);
    assert.ok(habits.json[0].streak.best >= 5);

    const report = await call('GET', '/api/reports/weekly', token);
    assert.equal(report.status, 200);
    assert.ok(report.json.nextImprovement.length > 0);
    assert.ok(Array.isArray(report.json.frequentlyPostponed));
  });
});

describe('dashboard, review and coach', () => {
  it('builds the dashboard from saved data and plans next week', async () => {
    const { token, today } = await register('dash@example.com');
    await call('POST', '/api/tasks', token, { title: 'Plan', scheduledTime: '06:00', priority: 'high' });
    await call('POST', '/api/tasks', token, { title: 'Code', priority: 'low' });
    const d = await call('GET', '/api/dashboard', token);
    assert.equal(d.json.today.planned, 2);
    assert.equal(d.json.topPriorities[0].title, 'Plan');
    assert.equal(d.json.date, today);
    assert.ok(d.json.quote.length > 0);

    const review = await call('GET', '/api/review/weekly', token);
    assert.equal(review.status, 200);
    const planned = await call('POST', '/api/review/weekly/priorities', token, { priorities: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] });
    assert.equal(planned.status, 201);
    assert.equal(planned.json.created.length, 3);
    assert.equal((await call('POST', '/api/review/weekly/priorities', token, { priorities: [{ title: '1' }, { title: '2' }, { title: '3' }, { title: '4' }] })).status, 400);
  });

  it('falls back to the rule-based coach when no AI key is configured', async () => {
    const { token } = await register('coach@example.com');
    await call('POST', '/api/tasks', token, { title: 'Study maths', priority: 'high' });
    const s = await call('GET', '/api/coach/status', token);
    assert.equal(s.json.aiConfigured, false);
    const ask = await call('POST', '/api/coach/ask', token, { message: 'What should I focus on next?' });
    assert.equal(ask.json.source, 'rules');
    assert.match(ask.json.reply, /Study maths/);
    const quick = await call('POST', '/api/tasks/quick', token, { text: 'add call mom at 6pm tomorrow high priority for 20 minutes' });
    assert.equal(quick.status, 201);
    assert.equal(quick.json.task.title, 'call mom');
    assert.equal(quick.json.task.scheduledTime, '18:00');
    assert.equal(quick.json.task.priority, 'high');
    assert.equal(quick.json.task.durationMin, 20);
  });
});

describe('settings, export, demo data, reset', () => {
  it('keeps demo data separate from real data', async () => {
    const { token } = await register('demo@example.com');
    await call('POST', '/api/tasks', token, { title: 'My real task' });
    await call('POST', '/api/demo/load', token);
    const sample = await call('GET', '/api/tasks', token);
    assert.ok(sample.json.length >= 5 && !sample.json.some((t: any) => t.title === 'My real task'));
    assert.equal((await call('GET', '/api/dashboard', token)).json.demoMode, true);
    assert.ok((await call('GET', '/api/analytics', token)).json.totals.completed > 0);
    await call('DELETE', '/api/demo', token);
    const real = await call('GET', '/api/tasks', token);
    assert.deepEqual(real.json.map((t: any) => t.title), ['My real task']);
  });

  it('validates settings and gates unlockable themes', async () => {
    const { token } = await register('set@example.com');
    const ok = await call('PATCH', '/api/settings', token, { theme: 'light', weekStart: 0, voice: { rate: 1.25 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.voice.rate, 1.25);
    assert.equal(ok.json.voice.enabled, false); // nested merge keeps other values
    assert.equal((await call('PATCH', '/api/settings', token, { weekStart: 9 })).status, 400);
    assert.equal((await call('PATCH', '/api/settings', token, { nonsense: true })).status, 400);
    assert.equal((await call('PATCH', '/api/settings', token, { accent: 'ember' })).status, 403);
    assert.equal((await call('PATCH', '/api/me', token, { avatar: 'crown' })).status, 403);
  });

  it('exports safely and resets only with confirmation', async () => {
    const { token } = await register('export@example.com');
    await call('POST', '/api/tasks', token, { title: '=HYPERLINK("http://evil")', description: 'a, "quoted"' });
    const csv = await call('GET', '/api/export/csv?table=tasks', token);
    assert.equal(csv.status, 200);
    assert.ok(csv.json.includes("'=HYPERLINK"), 'formula cells are neutralised');
    assert.equal((await call('GET', '/api/export/json', token)).json.tasks.length, 1);
    assert.equal((await call('POST', '/api/data/reset', token, {})).status, 400);
    assert.equal((await call('POST', '/api/data/reset', token, { confirm: 'RESET MY DATA' })).status, 200);
    assert.equal((await call('GET', '/api/tasks', token)).json.length, 0);
  });
});
