import { z } from 'zod';
import type { DB } from './db.js';

export const CATEGORIES = ['Study', 'Coding', 'Fitness', 'Health', 'Personal', 'Projects', 'Custom'];

export const settingsSchema = z
  .object({
    timezone: z.string().default('UTC'),
    theme: z.enum(['dark', 'light']).default('dark'),
    accent: z.string().max(30).default('purple'),
    weekStart: z.number().int().min(0).max(6).default(1), // 0=Sun, 1=Mon
    dailyTargetPercent: z.number().int().min(1).max(100).default(50), // share of planned tasks that makes a day "count" for streaks
    weeklyTargetTasks: z.number().int().min(1).max(500).default(20),
    workingHours: z.object({ start: z.string(), end: z.string() }).default({ start: '09:00', end: '18:00' }),
    categories: z.array(z.string().min(1).max(30)).max(30).default(CATEGORIES),
    sounds: z.boolean().default(true),
    animations: z.boolean().default(true),
    voice: z
      .object({
        enabled: z.boolean().default(false),
        muted: z.boolean().default(false),
        rate: z.number().min(0.5).max(2).default(1),
        volume: z.number().min(0).max(1).default(1),
        voiceName: z.string().nullable().default(null),
      })
      .default({}),
    pomodoro: z
      .object({
        workMin: z.number().int().min(1).max(180).default(25),
        breakMin: z.number().int().min(1).max(60).default(5),
        longBreakMin: z.number().int().min(1).max(90).default(15),
        sessionsBeforeLong: z.number().int().min(2).max(10).default(4),
        ambientSound: z.string().nullable().default(null),
      })
      .default({}),
    reminders: z
      .object({
        enabled: z.boolean().default(false),
        morningPlanning: z.string().default('08:00'),
        eveningReflection: z.string().default('20:00'),
        goalDeadlineDaysBefore: z.number().int().min(0).max(30).default(3),
      })
      .default({}),
    privacy: z.object({ allowAiCoach: z.boolean().default(true) }).default({}),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings = (): Settings => settingsSchema.parse({});

export function loadSettings(db: DB, userId: number): Settings {
  const row = db.prepare('SELECT json FROM settings WHERE user_id = ?').get(userId) as { json: string } | undefined;
  if (!row) return defaultSettings();
  try {
    return settingsSchema.parse(JSON.parse(row.json));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(db: DB, userId: number, s: Settings): void {
  db.prepare(
    'INSERT INTO settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json',
  ).run(userId, JSON.stringify(s));
}

/** Deep-merge a partial update into current settings, then validate the result. */
export function mergeSettings(current: Settings, patch: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = { ...(cur as object), ...(v as object) };
    } else {
      out[k] = v;
    }
  }
  return settingsSchema.parse(out);
}
