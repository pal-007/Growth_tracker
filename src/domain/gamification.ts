import type { AuthedUser } from '../auth.js';
import type { DB } from '../db.js';
import { addDays, diffDays, startOfWeek } from '../util.js';
import { computeStreaks } from './stats.js';

// ---------- XP and levels ----------

export const PRIORITY_XP = { low: 10, medium: 15, high: 20 } as const;
export const XP = { journal: 15, focus: 20, milestone: 25, goal: 100, achievement: 25, challenge: 20 };

/** Total XP needed to *reach* level n: 50 * n * (n - 1). Level 1 starts at 0. */
export const xpForLevel = (n: number) => 50 * n * (n - 1);

export function levelInfo(xp: number) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    xp,
    level,
    xpIntoLevel: xp - floor,
    xpForNextLevel: next - floor,
    progressPercent: Math.round(((xp - floor) / (next - floor)) * 100),
  };
}

export function totalXp(db: DB, user: AuthedUser): number {
  const r = db.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM xp_events WHERE user_id = ? AND demo = ?').get(user.id, user.demo) as { xp: number };
  return r.xp;
}

/** Idempotent: awarding the same (kind, ref) twice is a no-op. Returns XP actually added. */
export function awardXp(db: DB, user: AuthedUser, kind: string, ref: string, xp: number, date: string): number {
  const r = db
    .prepare('INSERT OR IGNORE INTO xp_events (user_id, kind, ref, xp, date, demo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, kind, ref, xp, date, user.demo);
  return r.changes > 0 ? xp : 0;
}

export function revokeXp(db: DB, user: AuthedUser, kind: string, ref: string): void {
  db.prepare('DELETE FROM xp_events WHERE user_id = ? AND demo = ? AND kind = ? AND ref = ?').run(user.id, user.demo, kind, ref);
}

// ---------- Unlockables ----------

export const AVATARS = [
  { key: 'rocket', level: 1 },
  { key: 'star', level: 2 },
  { key: 'planet', level: 3 },
  { key: 'comet', level: 5 },
  { key: 'galaxy', level: 8 },
  { key: 'crown', level: 12 },
];
export const THEMES = [
  { key: 'purple', level: 1 },
  { key: 'ocean', level: 3 },
  { key: 'sunset', level: 5 },
  { key: 'aurora', level: 8 },
  { key: 'ember', level: 12 },
];

export function unlockables(level: number) {
  const mark = (xs: { key: string; level: number }[]) => xs.map((x) => ({ ...x, unlocked: level >= x.level }));
  return { avatars: mark(AVATARS), themes: mark(THEMES) };
}

export function isUnlocked(kind: 'avatar' | 'theme', key: string, level: number): boolean {
  const list = kind === 'avatar' ? AVATARS : THEMES;
  const found = list.find((x) => x.key === key);
  return !found || level >= found.level; // unknown/custom keys are not gated
}

// ---------- Achievements ----------

export const ACHIEVEMENTS = [
  { key: 'first_step', name: 'First Step', description: 'Complete your first task.' },
  { key: 'getting_consistent', name: 'Getting Consistent', description: 'Complete the same habit or task on seven separate days.' },
  { key: 'goal_crusher', name: 'Goal Crusher', description: 'Complete a goal.' },
  { key: 'comeback', name: 'Comeback', description: 'Return to completing tasks after a break of three or more days.' },
  { key: 'focus_master', name: 'Focus Master', description: 'Complete a planned focus session.' },
  { key: 'reflective', name: 'Reflective', description: 'Write a reflection on seven different days.' },
  { key: 'week_warrior', name: 'Steady Week', description: 'Keep a seven-day streak, rest days included.' },
  { key: 'milestone_maker', name: 'Milestone Maker', description: 'Finish five goal milestones.' },
];

function count(db: DB, sql: string, ...args: unknown[]): number {
  const r = db.prepare(sql).get(...args) as { c: number };
  return r.c;
}

/** Checks every achievement and unlocks the new ones. Safe to call after any action. */
export function evaluateAchievements(db: DB, user: AuthedUser): { key: string; name: string; xp: number }[] {
  const have = new Set(
    (db.prepare('SELECT key FROM achievements WHERE user_id = ? AND demo = ?').all(user.id, user.demo) as { key: string }[]).map((r) => r.key),
  );
  const unlocked: { key: string; name: string; xp: number }[] = [];
  const grant = (key: string) => {
    if (have.has(key)) return;
    db.prepare('INSERT OR IGNORE INTO achievements (user_id, key, date, demo) VALUES (?, ?, ?, ?)').run(user.id, key, user.today, user.demo);
    const xp = awardXp(db, user, 'achievement', key, XP.achievement, user.today);
    have.add(key);
    unlocked.push({ key, name: ACHIEVEMENTS.find((a) => a.key === key)!.name, xp });
  };
  const U = [user.id, user.demo];

  if (!have.has('first_step') && count(db, "SELECT COUNT(*) c FROM task_logs WHERE user_id=? AND demo=? AND status='completed'", ...U) > 0) grant('first_step');

  if (!have.has('getting_consistent')) {
    const r = db
      .prepare(
        "SELECT MAX(c) AS m FROM (SELECT COUNT(DISTINCT date) AS c FROM task_logs WHERE user_id=? AND demo=? AND status='completed' GROUP BY task_id)",
      )
      .get(...U) as { m: number | null };
    if ((r.m ?? 0) >= 7) grant('getting_consistent');
  }

  if (!have.has('goal_crusher') && count(db, "SELECT COUNT(*) c FROM goals WHERE user_id=? AND demo=? AND status='completed'", ...U) > 0) grant('goal_crusher');

  if (!have.has('comeback')) {
    const dates = (
      db.prepare("SELECT DISTINCT date FROM task_logs WHERE user_id=? AND demo=? AND status='completed' ORDER BY date").all(...U) as { date: string }[]
    ).map((r) => r.date);
    for (let i = 1; i < dates.length; i++) {
      if (diffDays(dates[i], dates[i - 1]) >= 4) {
        grant('comeback'); // 3+ empty days in between, then back
        break;
      }
    }
  }

  if (!have.has('focus_master') && count(db, 'SELECT COUNT(*) c FROM focus_sessions WHERE user_id=? AND demo=? AND completed=1', ...U) > 0) grant('focus_master');
  if (!have.has('reflective') && count(db, 'SELECT COUNT(DISTINCT date) c FROM journal WHERE user_id=? AND demo=?', ...U) >= 7) grant('reflective');
  if (!have.has('milestone_maker') && count(db, 'SELECT COUNT(*) c FROM milestones m JOIN goals g ON g.id=m.goal_id WHERE m.user_id=? AND g.demo=? AND m.done=1', ...U) >= 5) grant('milestone_maker');
  if (!have.has('week_warrior') && computeStreaks(db, user).current >= 7) grant('week_warrior');

  return unlocked;
}

// ---------- Challenges ----------

export interface Challenge {
  key: string;
  period: 'daily' | 'weekly';
  title: string;
  progress: number;
  target: number;
  done: boolean;
  xp: number;
}

export function challenges(db: DB, user: AuthedUser): Challenge[] {
  const weekStart = startOfWeek(user.today, user.settings.weekStart);
  const weekEnd = addDays(weekStart, 6);
  const U = [user.id, user.demo];
  const doneToday = count(db, "SELECT COUNT(*) c FROM task_logs WHERE user_id=? AND demo=? AND status='completed' AND date=?", ...U, user.today);
  const focusToday = count(db, 'SELECT COUNT(*) c FROM focus_sessions WHERE user_id=? AND demo=? AND completed=1 AND date=?', ...U, user.today);
  const reflectedToday = count(db, 'SELECT COUNT(*) c FROM journal WHERE user_id=? AND demo=? AND date=?', ...U, user.today);
  const doneWeek = count(db, "SELECT COUNT(*) c FROM task_logs WHERE user_id=? AND demo=? AND status='completed' AND date BETWEEN ? AND ?", ...U, weekStart, weekEnd);
  const focusWeek = count(db, 'SELECT COUNT(*) c FROM focus_sessions WHERE user_id=? AND demo=? AND completed=1 AND date BETWEEN ? AND ?', ...U, weekStart, weekEnd);
  const reflectedWeek = count(db, 'SELECT COUNT(DISTINCT date) c FROM journal WHERE user_id=? AND demo=? AND date BETWEEN ? AND ?', ...U, weekStart, weekEnd);

  const mk = (key: string, period: 'daily' | 'weekly', title: string, progress: number, target: number): Challenge => ({
    key,
    period,
    title,
    progress: Math.min(progress, target),
    target,
    done: progress >= target,
    xp: XP.challenge,
  });
  return [
    mk('daily_three', 'daily', 'Complete 3 tasks today', doneToday, 3),
    mk('daily_focus', 'daily', 'Finish one focus session', focusToday, 1),
    mk('daily_reflect', 'daily', 'Write today’s reflection', reflectedToday, 1),
    mk('weekly_tasks', 'weekly', `Complete ${user.settings.weeklyTargetTasks} tasks this week`, doneWeek, user.settings.weeklyTargetTasks),
    mk('weekly_focus', 'weekly', 'Finish three focus sessions this week', focusWeek, 3),
    mk('weekly_reflect', 'weekly', 'Reflect on four days this week', reflectedWeek, 4),
  ];
}

/** Pays out XP for challenges completed in the current period (once each). */
export function settleChallenges(db: DB, user: AuthedUser): number {
  const weekStart = startOfWeek(user.today, user.settings.weekStart);
  let gained = 0;
  for (const c of challenges(db, user)) {
    const ref = c.period === 'daily' ? `${c.key}:${user.today}` : `${c.key}:${weekStart}`;
    if (!c.done) {
      revokeXp(db, user, 'challenge', ref); // undoing a task can un-complete a challenge
      continue;
    }
    gained += awardXp(db, user, 'challenge', ref, c.xp, user.today);
  }
  return gained;
}

/** Call after any action that can earn something. Returns what was newly unlocked. */
export function syncRewards(db: DB, user: AuthedUser) {
  const challengeXp = settleChallenges(db, user);
  const achievements = evaluateAchievements(db, user);
  return { challengeXp, achievements, ...levelInfo(totalXp(db, user)) };
}
