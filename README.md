# LEVEL UP API

*One day at a time. One level at a time.*

REST API for the LEVEL UP personal growth app: routines, goals, habits, journal, focus timer,
analytics, weekly review, XP and achievements. Node 22.13+, TypeScript, Express, JWT auth, and Node's built-in
SQLite (no native compilation, so `npm install` works on Windows without Visual Studio).

## Quick start

```bash
npm install
cp .env.example .env        # then edit JWT_SECRET
npm run dev                 # http://localhost:4000
npm test                    # 13 end-to-end tests, in-memory database
# Node prints "SQLite is an experimental feature" on start. That warning is expected.
npm run build && npm start  # production
```

Set `NODE_ENV=production` and a real `JWT_SECRET` when deploying (the server refuses to start in production without one).
The SQLite file lives at `DATABASE_PATH` (default `./data/levelup.db`); put it on a persistent volume.

## Conventions

- Base path `/api`. Every route except `/api/auth/*` and `/health` needs `Authorization: Bearer <token>`.
- Dates are plain `YYYY-MM-DD` strings. "Today" is computed in the user's `timezone` setting, so a late-night
  completion lands on the right day.
- Errors: `{ "error": "message", "details": ... }` with 400 (validation), 401, 403, 404, 409, 429.
- Rewarding actions return a `rewards` object (`xpGained`, new `achievements`, `level`, `progressPercent`) and a
  `celebrate` flag so the UI can fire confetti, sound and voice.

## Endpoints

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login` |
| Profile | `GET/PATCH /me`, `POST /me/password`, `DELETE /me` (needs password + `"DELETE MY ACCOUNT"`) |
| Tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/reorder`, `POST /tasks/quick` (text or dictation) |
| Daily checklist | `GET /days/:date`, `PUT /days/:date/tasks/:taskId` (`not_started` = undo, `in_progress`, `completed`, `skipped`) |
| Dashboard | `GET /dashboard` |
| Goals | `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`, `POST /goals/:id/milestones`, `PATCH/DELETE /goals/:id/milestones/:mid` |
| Habits | `GET /habits`, `GET /habits/:id/history` (a habit is a task with `isHabit: true`) |
| Journal | `GET /journal`, `GET/PUT/DELETE /journal/:date`, `GET /journal/prompts`, `GET /journal/insights/mood` |
| Focus | `GET /focus/queue`, `POST/GET /focus/sessions`, `DELETE /focus/sessions/:id` |
| Analytics | `GET /analytics?from&to`, `GET /reports/daily`, `GET /reports/weekly` |
| Weekly review | `GET /review/weekly`, `POST /review/weekly/priorities` (up to 3 → scheduled tasks) |
| Gamification | `GET /gamification/profile` (level, achievements, challenges, personal bests, unlockables, timeline) |
| Coach / voice text | `GET /coach/status`, `GET /coach/briefing?type=morning\|today\|next\|week\|evening\|reminders`, `POST /coach/ask` |
| Settings | `GET/PATCH /settings` |
| Data | `GET /export/json`, `GET /export/csv?table=`, `POST /data/reset`, `GET/POST /demo…`, `DELETE /demo` |

Task fields: `title`, `description`, `category`, `scheduledTime` (HH:MM), `reminderMinutes`, `durationMin`,
`priority` (low/medium/high), `repeatType` (none/daily/selected_days/weekly/custom), `repeatDays` (0=Sun…6=Sat),
`repeatInterval` (custom: every N days), `startDate`, `endDate`, `goalId`, `isHabit`.

## How the important rules work

**Recurring tasks keep history.** A task is a template. Each day's state is a separate row in `task_logs`,
so a new day starts fresh and earlier completions are never overwritten or deleted.
`DELETE /tasks/:id?keepHistory=true` stops a task recurring but keeps its past records.

**Analytics never invent numbers.** `completionPercent` is `null` (not 0) on days with nothing planned, before
tracking began, and in the future. Skipped, missed and unresolved tasks are counted separately.
Comparisons and mood patterns say "not enough data" instead of guessing, and describe patterns without claiming causes.

**Gentle streaks.** A day counts when you complete at least `dailyTargetPercent` of what was planned
(default 50%). Empty days don't break a streak, a day where everything left was deliberately *skipped* is a rest
day, and today never breaks a streak while it's still open.

**XP is idempotent.** Each reward is keyed by (kind, ref), so repeating a request or undoing and redoing a task
never double counts. Undo removes the XP. Level *n* needs `50·n·(n−1)` total XP.

**Demo data is separate.** `POST /demo/load` creates clearly marked sample data (`demo = 1`) and switches the
account into preview mode; every query is scoped to the current mode. `DELETE /demo` removes it. Real data is never touched.

**AI is optional.** Without `ANTHROPIC_API_KEY` the coach uses built-in rules and says so (`source: "rules"`).
With a key, `POST /coach/ask` calls the model from the server only. It sends aggregates and task titles, never journal
text, and falls back to rules if the service fails (`aiUnavailable: true`). Users can opt out with `privacy.allowAiCoach`.

## Known limits

- Notifications and voice run in the client (browser permissions, speech synthesis/recognition). The API supplies
  the schedule fields (`scheduledTime`, `reminderMinutes`, settings → `reminders`) and speakable text, but cannot
  push notifications while the app is closed.
- Editing a recurring task's schedule changes how past *unlogged* days are counted; logged days are always preserved.
- The rate limiter on `/auth` is in-memory and per process. Put a real limiter in front for multi-instance deployments.
- SQLite fits a single server. For multi-instance hosting, move to Postgres.
