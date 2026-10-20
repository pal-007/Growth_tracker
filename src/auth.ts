import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import type { DB } from './db.js';
import { isUnlocked, levelInfo, totalXp } from './domain/gamification.js';
import { loadSettings, saveSettings, defaultSettings, type Settings } from './settings.js';
import { HttpError, handler, parse, todayIn } from './util.js';

export interface AuthedUser {
  id: number;
  email: string;
  name: string;
  avatar: string;
  /** 1 when the user is viewing the optional demo dataset, else 0. Every query filters on this. */
  demo: 0 | 1;
  settings: Settings;
  /** "Today" in the user's own timezone, as YYYY-MM-DD. */
  today: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user: AuthedUser;
  }
}

const signToken = (id: number) => jwt.sign({ sub: id }, config.jwtSecret, { expiresIn: '30d' });

export function requireAuth(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new HttpError(401, 'Missing bearer token');
      let id: number;
      try {
        id = Number((jwt.verify(token, config.jwtSecret) as jwt.JwtPayload).sub);
      } catch {
        throw new HttpError(401, 'Invalid or expired token');
      }
      const row = db.prepare('SELECT id, email, name, avatar, demo_mode FROM users WHERE id = ?').get(id) as
        | { id: number; email: string; name: string; avatar: string; demo_mode: number }
        | undefined;
      if (!row) throw new HttpError(401, 'Account no longer exists');
      const settings = loadSettings(db, row.id);
      req.user = {
        id: row.id,
        email: row.email,
        name: row.name,
        avatar: row.avatar,
        demo: row.demo_mode ? 1 : 0,
        settings,
        today: todayIn(settings.timezone),
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

const credentials = z.object({
  email: z.string().email().max(200).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
});

export function authRouter(db: DB): Router {
  const r = Router();

  r.post(
    '/register',
    handler((req, res) => {
      const body = parse(credentials.extend({ name: z.string().min(1).max(80), timezone: z.string().optional() }), req.body);
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
        throw new HttpError(409, 'An account with this email already exists');
      }
      const hash = bcrypt.hashSync(body.password, 10);
      const info = db
        .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
        .run(body.email, hash, body.name);
      const id = Number(info.lastInsertRowid);
      const settings = defaultSettings();
      if (body.timezone) settings.timezone = body.timezone;
      saveSettings(db, id, settings);
      res.status(201).json({ token: signToken(id), user: { id, email: body.email, name: body.name } });
    }),
  );

  r.post(
    '/login',
    handler((req, res) => {
      const body = parse(credentials, req.body);
      const row = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(body.email) as
        | { id: number; email: string; name: string; password_hash: string }
        | undefined;
      // Same message for unknown email and wrong password.
      if (!row || !bcrypt.compareSync(body.password, row.password_hash)) {
        throw new HttpError(401, 'Incorrect email or password');
      }
      res.json({ token: signToken(row.id), user: { id: row.id, email: row.email, name: row.name } });
    }),
  );

  return r;
}

/** Profile routes, mounted behind requireAuth. */
export function profileRouter(db: DB): Router {
  const r = Router();

  r.get(
    '/',
    handler((req, res) => {
      const { id, email, name, avatar, demo, today } = req.user;
      res.json({ id, email, name, avatar, demoMode: !!demo, today });
    }),
  );

  r.patch(
    '/',
    handler((req, res) => {
      const body = parse(
        z.object({ name: z.string().min(1).max(80).optional(), avatar: z.string().min(1).max(40).optional() }),
        req.body,
      );
      if (body.avatar && !isUnlocked('avatar', body.avatar, levelInfo(totalXp(db, req.user)).level)) {
        throw new HttpError(403, 'That avatar unlocks at a higher level');
      }
      if (body.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, req.user.id);
      if (body.avatar) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(body.avatar, req.user.id);
      const row = db.prepare('SELECT id, email, name, avatar FROM users WHERE id = ?').get(req.user.id);
      res.json(row);
    }),
  );

  r.post(
    '/password',
    handler((req, res) => {
      const body = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(200) }), req.body);
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id) as { password_hash: string };
      if (!bcrypt.compareSync(body.currentPassword, row.password_hash)) throw new HttpError(403, 'Current password is wrong');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.newPassword, 10), req.user.id);
      res.json({ ok: true });
    }),
  );

  /** Permanently delete the account and every record that belongs to it. */
  r.delete(
    '/',
    handler((req, res) => {
      const body = parse(z.object({ password: z.string(), confirm: z.literal('DELETE MY ACCOUNT') }), req.body);
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id) as { password_hash: string };
      if (!bcrypt.compareSync(body.password, row.password_hash)) throw new HttpError(403, 'Password is wrong');
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
      res.json({ ok: true });
    }),
  );

  return r;
}
