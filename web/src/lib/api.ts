const TOKEN_KEY = 'levelup.token';
const SERVER_KEY = 'levelup.server';

/** True inside the Android app, where the page is bundled and the server is somewhere else. */
export const isNativeApp = () => !!(window as any).Capacitor?.isNativePlatform?.();

export const getServer = () => { try { return localStorage.getItem(SERVER_KEY) ?? ''; } catch { return ''; } };
export const setServer = (url: string) => {
  const clean = url.trim().replace(/\/+$/, '');
  if (clean) localStorage.setItem(SERVER_KEY, clean); else localStorage.removeItem(SERVER_KEY);
};
/** Base URL for API calls. In a browser served by the API it is relative; in the app it is the saved server address. */
const base = () => (isNativeApp() ? getServer() : '');

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Is it running?');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event('auth:logout'));
    }
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b);

/** Download an authenticated file (export) through the browser. */
export async function download(path: string, filename: string) {
  const res = await fetch(`${base()}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Shapes returned by the API ----------
export type Status = 'not_started' | 'in_progress' | 'completed' | 'skipped';
export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: number;
  title: string;
  description: string;
  category: string;
  scheduledTime: string | null;
  reminderMinutes: number | null;
  durationMin: number | null;
  priority: Priority;
  repeatType: 'none' | 'daily' | 'selected_days' | 'weekly' | 'custom';
  repeatDays: number[];
  repeatInterval: number;
  startDate: string;
  endDate: string | null;
  goalId: number | null;
  isHabit: boolean;
}
export interface DayTask extends Task {
  status: Status;
  completedAt: string | null;
  note: string;
  overdue: boolean;
}
export interface DaySummary {
  planned: number; completed: number; skipped: number; inProgress: number; remaining: number;
  completionPercent: number | null; allDone: boolean; message: string;
}
export interface Rewards {
  xpGained?: number;
  achievements?: { key: string; name: string; xp: number }[];
  level: number; xp: number; xpIntoLevel: number; xpForNextLevel: number; progressPercent: number;
  challengeXp?: number;
}
export interface Milestone { id: number; title: string; dueDate: string | null; done: boolean; doneAt: string | null }
export interface Goal {
  id: number; title: string; description: string; category: string; startDate: string | null; targetDate: string | null;
  priority: Priority; targetValue: number | null; currentValue: number; unit: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'paused'; progressPercent: number | null;
  progressBasis: string; daysLeft: number | null; overdue: boolean; milestones: Milestone[];
  linkedTasks?: (Task & { last30Days: { planned: number; completed: number; completionPercent: number | null } })[];
}
export interface Settings {
  timezone: string; theme: 'dark' | 'light'; accent: string; weekStart: number; dailyTargetPercent: number; weeklyTargetTasks: number;
  workingHours: { start: string; end: string }; categories: string[]; sounds: boolean; animations: boolean;
  voice: { enabled: boolean; muted: boolean; rate: number; volume: number; voiceName: string | null };
  pomodoro: { workMin: number; breakMin: number; longBreakMin: number; sessionsBeforeLong: number; ambientSound: string | null };
  reminders: { enabled: boolean; morningPlanning: string; eveningReflection: string; goalDeadlineDaysBefore: number };
  privacy: { allowAiCoach: boolean };
}
export interface Me { id: number; email: string; name: string; avatar: string; demoMode: boolean; today: string }
