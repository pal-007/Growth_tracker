import type { AuthedUser } from '../auth.js';
import type { DB } from '../db.js';
import { pct } from '../util.js';
import { dayItems } from './schedule.js';

export function summarizeDay(db: DB, u: AuthedUser, d: string) {
  const items = dayItems(db, u, d);
  const planned = items.length;
  const completed = items.filter((i) => i.status === 'completed').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const inProgress = items.filter((i) => i.status === 'in_progress').length;
  const percent = pct(completed, planned);
  const remaining = planned - completed - skipped;
  let message: string;
  if (planned === 0) message = 'Nothing planned for this day yet. Add a task to get started.';
  else if (remaining === 0 && completed === planned) message = 'Everything done. Great work today.';
  else if (remaining === 0) message = `All wrapped up: ${completed} done, ${skipped} skipped on purpose.`;
  else if (completed === 0) message = `${planned} planned. Start with one small win.`;
  else message = `Your day is ${percent}% complete. ${completed} down, ${remaining} to go. Keep moving!`;
  return { planned, completed, skipped, inProgress, remaining, completionPercent: percent, allDone: planned > 0 && remaining === 0, message };
}
