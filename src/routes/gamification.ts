import { Router } from 'express';
import type { DB } from '../db.js';
import { ACHIEVEMENTS, challenges, levelInfo, syncRewards, totalXp, unlockables } from '../domain/gamification.js';
import { computeStreaks } from '../domain/stats.js';
import { handler, startOfWeek } from '../util.js';

export function gamificationRouter(db: DB): Router {
  const r = Router();

  r.get(
    '/gamification/profile',
    handler((req, res) => {
      const u = req.user;
      syncRewards(db, u); // settle anything earned since the last call
      const xp = totalXp(db, u);
      const info = levelInfo(xp);
      const got = new Map(
        (db.prepare('SELECT key, date FROM achievements WHERE user_id = ? AND demo = ?').all(u.id, u.demo) as { key: string; date: string }[]).map((a) => [a.key, a.date]),
      );
      const streak = computeStreaks(db, u);

      const perDay = db
        .prepare("SELECT date, COUNT(*) AS c FROM task_logs WHERE user_id = ? AND demo = ? AND status = 'completed' GROUP BY date")
        .all(u.id, u.demo) as { date: string; c: number }[];
      const weeks = new Map<string, number>();
      for (const d of perDay) {
        const w = startOfWeek(d.date, u.settings.weekStart);
        weeks.set(w, (weeks.get(w) ?? 0) + d.c);
      }
      const longestFocus = (db.prepare('SELECT COALESCE(MAX(actual_min), 0) AS m FROM focus_sessions WHERE user_id = ? AND demo = ? AND completed = 1').get(u.id, u.demo) as { m: number }).m;

      const timeline = [
        ...(db.prepare('SELECT key, date FROM achievements WHERE user_id = ? AND demo = ?').all(u.id, u.demo) as { key: string; date: string }[]).map((a) => ({
          date: a.date, type: 'achievement', title: `Unlocked ${ACHIEVEMENTS.find((x) => x.key === a.key)?.name ?? a.key}`,
        })),
        ...(db.prepare("SELECT title, substr(completed_at, 1, 10) AS date FROM goals WHERE user_id = ? AND demo = ? AND status = 'completed' AND completed_at IS NOT NULL").all(u.id, u.demo) as { title: string; date: string }[]).map((g) => ({
          date: g.date, type: 'goal', title: `Completed goal: ${g.title}`,
        })),
        ...(db.prepare('SELECT m.title, substr(m.done_at, 1, 10) AS date FROM milestones m JOIN goals g ON g.id = m.goal_id WHERE m.user_id = ? AND g.demo = ? AND m.done = 1 AND m.done_at IS NOT NULL').all(u.id, u.demo) as { title: string; date: string }[]).map((m) => ({
          date: m.date, type: 'milestone', title: `Reached milestone: ${m.title}`,
        })),
      ]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 50);

      res.json({
        ...info,
        avatar: u.avatar,
        achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: got.has(a.key), unlockedOn: got.get(a.key) ?? null })),
        challenges: challenges(db, u),
        streak,
        personalBests: {
          mostTasksInADay: perDay.reduce((m, d) => Math.max(m, d.c), 0),
          mostTasksInAWeek: [...weeks.values()].reduce((m, c) => Math.max(m, c), 0),
          bestStreakDays: streak.best,
          longestFocusSessionMin: longestFocus,
        },
        unlockables: unlockables(info.level),
        timeline,
      });
    }),
  );

  return r;
}
