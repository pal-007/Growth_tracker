import {
  BarChart3, BookHeart, CalendarCheck, Flame, Focus, LayoutDashboard, ListChecks, Menu, Mic, Settings as Cog, Target, Trophy, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { get, type DaySummary, type DayTask } from '../lib/api';
import { notify } from '../lib/fx';
import { useApp } from '../store';
import Assistant from './Assistant';
import { AVATAR_EMOJI, ProgressBar } from './ui';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/routine', label: 'My Routine', icon: ListChecks },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/habits', label: 'Habits', icon: Flame },
  { to: '/focus', label: 'Focus Timer', icon: Focus },
  { to: '/analytics', label: 'Growth Analytics', icon: BarChart3 },
  { to: '/journal', label: 'Journal', icon: BookHeart },
  { to: '/review', label: 'Weekly Review', icon: CalendarCheck },
  { to: '/achievements', label: 'Achievements', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: Cog },
];
const MOBILE_MAIN = ['/', '/routine', '/focus', '/journal'];

function nowIn(tz: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch {
    return new Date().toTimeString().slice(0, 5);
  }
}
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/**
 * In-app reminders. They fire only while LEVEL UP is open in a browser tab, because the browser
 * can't run this code once the page is closed.
 */
function useReminders() {
  const { settings, me, toast, say } = useApp();
  const cache = useRef<{ at: number; date: string; tasks: DayTask[] } | null>(null);

  useEffect(() => {
    if (!settings || !me) return;
    const fireOnce = (key: string, title: string, body: string) => {
      const k = `levelup.fired.${key}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
      notify(title, body);
      toast('info', title, body);
      say(`${title}. ${body}`);
    };
    const tick = async () => {
      const now = nowIn(settings.timezone);
      const nowM = minutes(now);
      try {
        if (!cache.current || Date.now() - cache.current.at > 120_000) {
          const d = await get<{ date: string; tasks: DayTask[]; summary: DaySummary }>(`/days/${me.today}`);
          cache.current = { at: Date.now(), date: d.date, tasks: d.tasks };
        }
        for (const t of cache.current.tasks) {
          if (t.status === 'completed' || t.status === 'skipped' || !t.scheduledTime || t.reminderMinutes == null) continue;
          const due = minutes(t.scheduledTime) - t.reminderMinutes;
          if (nowM >= due && nowM <= due + 2) fireOnce(`${me.today}.${t.id}`, `Coming up: ${t.title}`, t.scheduledTime ? `Scheduled for ${t.scheduledTime}.` : '');
        }
        if (settings.reminders.enabled) {
          const m = minutes(settings.reminders.morningPlanning);
          const e = minutes(settings.reminders.eveningReflection);
          if (nowM >= m && nowM <= m + 2) fireOnce(`${me.today}.morning`, 'Good morning!', 'Let’s plan a great day.');
          if (nowM >= e && nowM <= e + 2) fireOnce(`${me.today}.evening`, 'Evening reflection', 'How was your day? Take a minute to reflect.');
        }
      } catch { /* offline or logged out: try again next tick */ }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [settings, me, toast, say]);
}

export default function Layout() {
  const { me, settings, toasts, dismiss, version, noteLevel } = useApp();
  const [more, setMore] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [level, setLevel] = useState<{ level: number; progressPercent: number } | null>(null);
  const loc = useLocation();
  useReminders();

  useEffect(() => { setMore(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  useEffect(() => {
    get('/gamification/profile').then((p) => { setLevel({ level: p.level, progressPercent: p.progressPercent }); noteLevel(p.level); }).catch(() => {});
  }, [version, noteLevel]);

  const sideLink = ({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? 'active' : ''}`;

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] btn btn-primary">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 h-screen sticky top-0 p-4 gap-4" aria-label="Main">
        <div className="glass p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl grad-bg grid place-items-center text-xl pulse" aria-hidden>🚀</div>
          <div><div className="display font-bold text-lg leading-none grad-text">LEVEL UP</div><div className="text-[11px] muted mt-1 leading-tight">One day at a time.<br />One level at a time.</div></div>
        </div>
        <nav className="glass p-2 flex-1 overflow-y-auto space-y-1">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={sideLink}><n.icon size={18} />{n.label}</NavLink>)}
        </nav>
        <div className="glass p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full grad-bg grid place-items-center text-xl" aria-hidden>{AVATAR_EMOJI[me?.avatar ?? 'rocket'] ?? '🚀'}</div>
            <div className="min-w-0"><div className="font-semibold truncate">{me?.name}</div><div className="text-xs muted">Level {level?.level ?? 1}</div></div>
          </div>
          <ProgressBar value={level?.progressPercent ?? 0} className="mt-3" label="Level progress" />
          {me?.demoMode && <div className="chip mt-3" style={{ color: 'var(--warn)' }}>Preview mode: sample data</div>}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 backdrop-blur-xl border-b" style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)', borderColor: 'var(--card-border)' }}>
          <div className="flex items-center gap-2"><span className="text-xl" aria-hidden>🚀</span><span className="display font-bold grad-text">LEVEL UP</span></div>
          <div className="flex items-center gap-2">
            {me?.demoMode && <span className="chip" style={{ color: 'var(--warn)' }}>Preview</span>}
            <span className="chip">Lv {level?.level ?? 1}</span>
          </div>
        </header>
        {me?.demoMode && (
          <div className="hidden lg:block text-center text-sm py-1.5" style={{ background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }}>
            You’re viewing sample data. Your own records are untouched. Turn this off in Settings.
          </div>
        )}
        <main id="main" className="px-4 sm:px-6 lg:px-8 py-6 pb-28 lg:pb-10 max-w-6xl mx-auto page-enter" key={loc.pathname}>
          <Outlet />
        </main>
      </div>

      {/* Assistant button */}
      {settings && (
        <button className="fixed z-40 right-4 bottom-24 lg:bottom-6 btn btn-primary !rounded-full !p-4 shadow-xl" onClick={() => setAssistant(true)} aria-label="Open voice assistant">
          <Mic size={20} />
        </button>
      )}
      <Assistant open={assistant} onClose={() => setAssistant(false)} />

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex justify-around px-2 py-2 backdrop-blur-xl border-t" style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)', borderColor: 'var(--card-border)' }} aria-label="Main">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] ${isActive ? 'text-white grad-bg' : 'muted'}`}>
            <n.icon size={20} />{n.label.replace('My ', '')}
          </NavLink>
        ))}
        <button className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] muted" onClick={() => setMore(true)} aria-label="More sections"><Menu size={20} />More</button>
      </nav>
      {more && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="All sections">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMore(false)} />
          <div className="glass absolute bottom-0 inset-x-0 p-4 page-enter !rounded-b-none" style={{ background: 'var(--card-solid)' }}>
            <div className="flex justify-between items-center mb-3"><h2 className="font-semibold">All sections</h2><button className="btn btn-icon" onClick={() => setMore(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={sideLink}><n.icon size={18} />{n.label}</NavLink>)}
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed z-[60] top-4 right-4 left-4 sm:left-auto sm:w-96 space-y-2 pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass toast-enter p-3.5 pointer-events-auto flex gap-3 items-start" style={{ background: 'var(--card-solid)', borderColor: t.kind === 'error' ? 'var(--bad)' : t.kind === 'reward' ? 'var(--a1)' : undefined }}>
            <div className="flex-1"><div className="font-semibold text-sm">{t.title}</div>{t.body && <div className="text-xs muted mt-0.5">{t.body}</div>}</div>
            <button className="muted" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
