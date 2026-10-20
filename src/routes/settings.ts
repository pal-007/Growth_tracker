import { Router } from 'express';
import type { DB } from '../db.js';
import { levelInfo, isUnlocked, totalXp } from '../domain/gamification.js';
import { mergeSettings, saveSettings } from '../settings.js';
import { HttpError, handler } from '../util.js';

export function settingsRouter(db: DB): Router {
  const r = Router();

  r.get('/settings', handler((req, res) => res.json(req.user.settings)));

  r.patch(
    '/settings',
    handler((req, res) => {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Send a JSON object of settings to change');
      let next;
      try {
        next = mergeSettings(req.user.settings, req.body as Record<string, unknown>);
      } catch (e) {
        throw new HttpError(400, 'Invalid settings', e instanceof Error && 'flatten' in e ? (e as { flatten(): unknown }).flatten() : undefined);
      }
      // Themes are unlocked by leveling up.
      if (next.accent !== req.user.settings.accent) {
        const level = levelInfo(totalXp(db, req.user)).level;
        if (!isUnlocked('theme', next.accent, level)) throw new HttpError(403, `The “${next.accent}” theme unlocks at a higher level`);
      }
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: next.timezone });
      } catch {
        throw new HttpError(400, 'Unknown timezone');
      }
      saveSettings(db, req.user.id, next);
      res.json(next);
    }),
  );

  return r;
}
