import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { XP, awardXp, revokeXp, syncRewards } from '../domain/gamification.js';
import { HttpError, addDays, handler, notFound, parse, round1 } from '../util.js';
import { parseDate } from './tasks.js';

const text = z.string().max(4000);
const entrySchema = z
  .object({
    wentWell: text, learned: text, difficult: text, distracted: text, proud: text, improve: text, notes: text,
    mood: z.number().int().min(1).max(5).nullable(),
    energy: z.number().int().min(1).max(5).nullable(),
  })
  .partial();

interface Row {
  id: number; date: string; went_well: string; learned: string; difficult: string; distracted: string; proud: string;
  improve: string; notes: string; mood: number | null; energy: number | null; updated_at: string;
}

export const MOODS = ['', 'rough', 'low', 'okay', 'good', 'great'];

export const serializeEntry = (r: Row) => ({
  id: r.id, date: r.date, wentWell: r.went_well, learned: r.learned, difficult: r.difficult, distracted: r.distracted,
  proud: r.proud, improve: r.improve, notes: r.notes, mood: r.mood, moodLabel: r.mood ? MOODS[r.mood] : null, energy: r.energy,
  updatedAt: r.updated_at,
});

const hasContent = (r: Row) =>
  [r.went_well, r.learned, r.difficult, r.distracted, r.proud, r.improve, r.notes].some((s) => s.trim()) || r.mood != null || r.energy != null;

export function journalRouter(db: DB): Router {
  const r = Router();

  /** Prompts shown in the UI; kept server-side so every client asks the same questions. */
  r.get('/journal/prompts', handler((_req, res) =>
    res.json([
      { field: 'wentWell', question: 'What went well today?' },
      { field: 'learned', question: 'What did I learn?' },
      { field: 'difficult', question: 'What was difficult?' },
      { field: 'distracted', question: 'What distracted me?' },
      { field: 'proud', question: 'What am I proud of today?' },
      { field: 'improve', question: 'What is one thing I want to improve tomorrow?' },
    ]),
  ));

  r.get(
    '/journal',
    handler((req, res) => {
      const u = req.user;
      const from = typeof req.query.from === 'string' ? parseDate(req.query.from) : addDays(u.today, -89);
      const to = typeof req.query.to === 'string' ? parseDate(req.query.to) : u.today;
      const rows = db
        .prepare('SELECT * FROM journal WHERE user_id = ? AND demo = ? AND date BETWEEN ? AND ? ORDER BY date DESC')
        .all(u.id, u.demo, from, to) as Row[];
      res.json(rows.map(serializeEntry));
    }),
  );

  r.get(
    '/journal/:date',
    handler((req, res) => {
      const u = req.user;
      const d = parseDate(String(req.params.date));
      const row = db.prepare('SELECT * FROM journal WHERE user_id = ? AND demo = ? AND date = ?').get(u.id, u.demo, d) as Row | undefined;
      if (!row) throw notFound('Journal entry');
      res.json(serializeEntry(row));
    }),
  );

  /** Create or update the reflection for a date (one per day). */
  r.put(
    '/journal/:date',
    handler((req, res) => {
      const u = req.user;
      const d = parseDate(String(req.params.date));
      if (d > u.today) throw new HttpError(400, 'You can’t write a reflection for a future day');
      const b = parse(entrySchema, req.body);
      const cur = db.prepare('SELECT * FROM journal WHERE user_id = ? AND demo = ? AND date = ?').get(u.id, u.demo, d) as Row | undefined;
      const v = {
        went_well: b.wentWell ?? cur?.went_well ?? '', learned: b.learned ?? cur?.learned ?? '', difficult: b.difficult ?? cur?.difficult ?? '',
        distracted: b.distracted ?? cur?.distracted ?? '', proud: b.proud ?? cur?.proud ?? '', improve: b.improve ?? cur?.improve ?? '',
        notes: b.notes ?? cur?.notes ?? '', mood: b.mood !== undefined ? b.mood : cur?.mood ?? null, energy: b.energy !== undefined ? b.energy : cur?.energy ?? null,
      };
      db.prepare(
        `INSERT INTO journal (user_id, date, went_well, learned, difficult, distracted, proud, improve, notes, mood, energy, demo, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, date, demo) DO UPDATE SET went_well=excluded.went_well, learned=excluded.learned, difficult=excluded.difficult,
           distracted=excluded.distracted, proud=excluded.proud, improve=excluded.improve, notes=excluded.notes, mood=excluded.mood,
           energy=excluded.energy, updated_at=datetime('now')`,
      ).run(u.id, d, v.went_well, v.learned, v.difficult, v.distracted, v.proud, v.improve, v.notes, v.mood, v.energy, u.demo);
      const row = db.prepare('SELECT * FROM journal WHERE user_id = ? AND demo = ? AND date = ?').get(u.id, u.demo, d) as Row;
      let rewards;
      if (hasContent(row)) {
        awardXp(db, u, 'journal', d, XP.journal, d);
        rewards = syncRewards(db, u);
      }
      res.json({ entry: serializeEntry(row), rewards });
    }),
  );

  r.delete(
    '/journal/:date',
    handler((req, res) => {
      const u = req.user;
      const d = parseDate(String(req.params.date));
      revokeXp(db, u, 'journal', d);
      const info = db.prepare('DELETE FROM journal WHERE user_id = ? AND demo = ? AND date = ?').run(u.id, u.demo, d);
      if (!info.changes) throw notFound('Journal entry');
      res.json({ ok: true });
    }),
  );

  /**
   * Descriptive mood/energy vs completion. This only reports what happened on the same days.
   * It does not say one drives the other, and it refuses to compute with too little data.
   */
  r.get(
    '/journal/insights/mood',
    handler((req, res) => {
      const u = req.user;
      const days = Math.min(365, Math.max(7, Number(req.query.days) || 60));
      const from = addDays(u.today, -(days - 1));
      const rows = db
        .prepare(
          `SELECT j.date, j.mood, j.energy,
             (SELECT COUNT(*) FROM task_logs l WHERE l.user_id = j.user_id AND l.demo = j.demo AND l.date = j.date AND l.status = 'completed') AS completed
           FROM journal j WHERE j.user_id = ? AND j.demo = ? AND j.date BETWEEN ? AND ? AND j.mood IS NOT NULL`,
        )
        .all(u.id, u.demo, from, u.today) as { date: string; mood: number; energy: number | null; completed: number }[];
      const MIN = 5;
      const groups = [1, 2, 3, 4, 5].map((m) => {
        const g = rows.filter((x) => x.mood === m);
        return { mood: m, label: MOODS[m], days: g.length, avgTasksCompleted: g.length ? round1(g.reduce((s, x) => s + x.completed, 0) / g.length) : null };
      });
      res.json({
        windowDays: days,
        daysWithMood: rows.length,
        enoughData: rows.length >= MIN,
        byMood: groups,
        note: rows.length >= MIN
          ? 'These are averages on days you logged each mood. They show a pattern in your own records, not a cause.'
          : `Log mood on at least ${MIN} days to see a pattern. You have ${rows.length} so far.`,
      });
    }),
  );

  return r;
}
