import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authRouter, profileRouter, requireAuth } from './auth.js';
import { config } from './config.js';
import type { DB } from './db.js';
import { analyticsRouter } from './routes/analytics.js';
import { coachRouter } from './routes/coach.js';
import { dataRouter } from './routes/data.js';
import { focusRouter } from './routes/focus.js';
import { gamificationRouter } from './routes/gamification.js';
import { goalsRouter } from './routes/goals.js';
import { habitsRouter } from './routes/habits.js';
import { journalRouter } from './routes/journal.js';
import { settingsRouter } from './routes/settings.js';
import { tasksRouter } from './routes/tasks.js';
import { HttpError, errorMiddleware } from './util.js';

/** Tiny fixed-window limiter for the login/register endpoints (per IP, in memory). */
function authLimiter(max = 20, windowMs = 60_000) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return next(new HttpError(429, 'Too many attempts. Please wait a minute and try again.'));
    next();
  };
}

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '200kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, app: 'LEVEL UP API', tagline: 'One day at a time. One level at a time.' }));

  const api = express.Router();
  api.use('/auth', authLimiter(), authRouter(db));

  api.use(requireAuth(db)); // everything below needs a valid token
  api.use('/me', profileRouter(db));
  for (const mk of [tasksRouter, goalsRouter, habitsRouter, journalRouter, focusRouter, gamificationRouter, settingsRouter, dataRouter, analyticsRouter, coachRouter]) {
    api.use(mk(db));
  }
  app.use('/api', api);

  // Serve the built web app (web/dist) from the same server, so one command runs everything.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api(\/|$)|health$).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));
  app.use(errorMiddleware);
  return app;
}
