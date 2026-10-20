import { Router } from 'express';
import { z } from 'zod';
import type { AuthedUser } from '../auth.js';
import type { DB } from '../db.js';
import { PRIORITY_XP, XP, awardXp, syncRewards } from '../domain/gamification.js';
import { addDays, dateRange, handler, parse, weekday } from '../util.js';

const TABLES = {
  tasks: 'SELECT id, title, description, category, scheduled_time, reminder_minutes, duration_min, priority, repeat_type, repeat_days, repeat_interval, start_date, end_date, goal_id, is_habit FROM tasks WHERE user_id = ? AND demo = ? ORDER BY id',
  logs: 'SELECT l.date, l.task_id, t.title AS task_title, l.status, l.completed_at, l.note FROM task_logs l JOIN tasks t ON t.id = l.task_id WHERE l.user_id = ? AND l.demo = ? ORDER BY l.date, l.task_id',
  goals: 'SELECT id, title, description, category, start_date, target_date, priority, target_value, current_value, unit, status, completed_at FROM goals WHERE user_id = ? AND demo = ? ORDER BY id',
  milestones: 'SELECT m.id, m.goal_id, m.title, m.due_date, m.done, m.done_at FROM milestones m JOIN goals g ON g.id = m.goal_id WHERE m.user_id = ? AND g.demo = ? ORDER BY m.id',
  journal: 'SELECT date, went_well, learned, difficult, distracted, proud, improve, notes, mood, energy FROM journal WHERE user_id = ? AND demo = ? ORDER BY date',
  focus: 'SELECT id, task_id, date, work_min, break_min, actual_min, completed FROM focus_sessions WHERE user_id = ? AND demo = ? ORDER BY id',
  xp: 'SELECT kind, ref, xp, date FROM xp_events WHERE user_id = ? AND demo = ? ORDER BY id',
  achievements: 'SELECT key, date FROM achievements WHERE user_id = ? AND demo = ? ORDER BY date',
} as const;
type TableName = keyof typeof TABLES;

/** CSV with a guard against spreadsheet formula injection (=, +, -, @ at the start of a cell). */
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

export function dataRouter(db: DB): Router {
  const r = Router();

  r.get(
    '/export/json',
    handler((req, res) => {
      const u = req.user;
      const out: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        app: 'LEVEL UP',
        demoData: !!u.demo,
        profile: { name: u.name, email: u.email },
        settings: u.settings,
      };
      for (const k of Object.keys(TABLES) as TableName[]) out[k] = db.prepare(TABLES[k]).all(u.id, u.demo);
      res.setHeader('Content-Disposition', 'attachment; filename="level-up-export.json"');
      res.json(out);
    }),
  );

  r.get(
    '/export/csv',
    handler((req, res) => {
      const u = req.user;
      const table = String(req.query.table ?? 'logs') as TableName;
      if (!(table in TABLES)) {
        res.status(400).json({ error: `table must be one of: ${Object.keys(TABLES).join(', ')}` });
        return;
      }
      const rows = db.prepare(TABLES[table]).all(u.id, u.demo) as Record<string, unknown>[];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="level-up-${table}.csv"`);
      res.send(toCsv(rows));
    }),
  );

  /** Wipes the user's real data. Demo data and the account itself are left alone unless asked. */
  r.post(
    '/data/reset',
    handler((req, res) => {
      const u = req.user;
      const b = parse(z.object({ confirm: z.literal('RESET MY DATA'), includeSettings: z.boolean().optional() }), req.body);
      db.transaction(() => wipe(db, u.id, 0))();
      if (b.includeSettings) db.prepare('DELETE FROM settings WHERE user_id = ?').run(u.id);
      res.json({ ok: true, message: 'Your data has been reset.' });
    }),
  );

  // ----- optional demo data, always kept apart from real records (demo = 1) -----

  r.get('/demo', handler((req, res) => {
    const has = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND demo = 1').get(req.user.id) as { c: number }).c > 0;
    res.json({ active: !!req.user.demo, loaded: has });
  }));

  /** Loads sample data and switches the account into preview mode. Real data is untouched. */
  r.post(
    '/demo/load',
    handler((req, res) => {
      const u = req.user;
      db.transaction(() => {
        wipe(db, u.id, 1);
        db.prepare('UPDATE users SET demo_mode = 1 WHERE id = ?').run(u.id);
        seedDemo(db, { ...u, demo: 1 });
      })();
      res.json({ ok: true, active: true, note: 'Preview mode is on. Everything you see is sample data. Your own data is untouched.' });
    }),
  );

  r.post('/demo/exit', handler((req, res) => {
    db.prepare('UPDATE users SET demo_mode = 0 WHERE id = ?').run(req.user.id);
    res.json({ ok: true, active: false });
  }));

  r.delete('/demo', handler((req, res) => {
    db.transaction(() => {
      wipe(db, req.user.id, 1);
      db.prepare('UPDATE users SET demo_mode = 0 WHERE id = ?').run(req.user.id);
    })();
    res.json({ ok: true, active: false });
  }));

  return r;
}

function wipe(db: DB, userId: number, demo: 0 | 1) {
  db.prepare('DELETE FROM task_logs WHERE user_id = ? AND demo = ?').run(userId, demo);
  db.prepare('DELETE FROM focus_sessions WHERE user_id = ? AND demo = ?').run(userId, demo);
  db.prepare('DELETE FROM tasks WHERE user_id = ? AND demo = ?').run(userId, demo);
  db.prepare('DELETE FROM goals WHERE user_id = ? AND demo = ?').run(userId, demo); // milestones cascade
  db.prepare('DELETE FROM journal WHERE user_id = ? AND demo = ?').run(userId, demo);
  db.prepare('DELETE FROM xp_events WHERE user_id = ? AND demo = ?').run(userId, demo);
  db.prepare('DELETE FROM achievements WHERE user_id = ? AND demo = ?').run(userId, demo);
}

function seedDemo(db: DB, u: AuthedUser) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const start = addDays(u.today, -27);

  const goal = db
    .prepare("INSERT INTO goals (user_id, title, description, category, start_date, target_date, priority, target_value, current_value, unit, status, demo) VALUES (?, 'Finish the web development course', 'Sample goal', 'Coding', ?, ?, 'high', 40, 22, 'lessons', 'in_progress', 1)")
    .run(u.id, start, addDays(u.today, 30));
  const gid = Number(goal.lastInsertRowid);
  ['Finish HTML and CSS', 'Build a small project', 'Learn a framework', 'Deploy it'].forEach((t, i) =>
    db.prepare('INSERT INTO milestones (goal_id, user_id, title, sort_order, done, done_at) VALUES (?, ?, ?, ?, ?, ?)').run(gid, u.id, t, i + 1, i < 2 ? 1 : 0, i < 2 ? new Date().toISOString() : null));

  const defs: [string, string, string, string, number, string, string, number[], number, number | null][] = [
    ['Morning workout', 'Fitness', '07:00', 'medium', 30, 'daily', '[]', [], 1, null],
    ['Code for 60 minutes', 'Coding', '18:00', 'high', 60, 'selected_days', '[1,2,3,4,5]', [1, 2, 3, 4, 5], 1, gid],
    ['Read 10 pages', 'Study', '21:00', 'low', 20, 'daily', '[]', [], 1, null],
    ['Project work', 'Projects', '16:00', 'medium', 90, 'selected_days', '[2,4]', [2, 4], 0, gid],
    ['Weekly planning', 'Personal', '10:00', 'medium', 30, 'weekly', '[]', [], 0, null],
  ];
  const tasks = defs.map((d, i) => {
    const info = db
      .prepare(
        `INSERT INTO tasks (user_id, title, category, scheduled_time, priority, duration_min, repeat_type, repeat_days, start_date, goal_id, is_habit, sort_order, demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(u.id, d[0], d[1], d[2], d[3], d[4], d[5], d[6], start, d[9], d[8], i + 1);
    return { id: Number(info.lastInsertRowid), def: d };
  });

  for (const date of dateRange(start, addDays(u.today, -1))) {
    let doneCount = 0;
    for (const t of tasks) {
      const [, , , priority, , repeat, , days] = t.def;
      const occurs = repeat === 'daily' || (repeat === 'weekly' && weekday(date) === weekday(start)) || days.includes(weekday(date));
      if (!occurs) continue;
      const x = rnd();
      if (x < 0.72) {
        db.prepare("INSERT INTO task_logs (user_id, task_id, date, status, completed_at, demo) VALUES (?, ?, ?, 'completed', ?, 1)").run(u.id, t.id, date, `${date}T12:00:00.000Z`);
        awardXp(db, u, 'task', `${t.id}:${date}`, PRIORITY_XP[priority as 'low' | 'medium' | 'high'], date);
        doneCount++;
      } else if (x < 0.8) {
        db.prepare("INSERT INTO task_logs (user_id, task_id, date, status, demo) VALUES (?, ?, ?, 'skipped', 1)").run(u.id, t.id, date);
      }
    }
    if (rnd() < 0.45) {
      const mood = Math.min(5, Math.max(1, 2 + doneCount + (rnd() < 0.3 ? 1 : 0)));
      db.prepare("INSERT INTO journal (user_id, date, went_well, difficult, mood, energy, demo) VALUES (?, ?, 'Sample entry', 'Sample entry', ?, ?, 1)").run(u.id, date, mood, Math.min(5, mood + (rnd() < 0.5 ? 0 : -1) || 1));
      awardXp(db, u, 'journal', date, XP.journal, date);
    }
  }
  for (let i = 0; i < 4; i++) {
    const info = db.prepare('INSERT INTO focus_sessions (user_id, date, work_min, break_min, actual_min, completed, demo) VALUES (?, ?, 25, 5, 25, 1, 1)').run(u.id, addDays(u.today, -i * 3 - 1));
    awardXp(db, u, 'focus', String(info.lastInsertRowid), 20, addDays(u.today, -i * 3 - 1));
  }
  syncRewards(db, u);
}
