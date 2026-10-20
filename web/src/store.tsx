import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, getToken, patch, setToken, type Me, type Rewards, type Settings } from './lib/api';
import { playChime, playComplete, playLevelUp, sparkle } from './lib/fx';
import { speak } from './lib/voice';

export interface Toast { id: number; kind: 'success' | 'error' | 'info' | 'reward'; title: string; body?: string }

interface Ctx {
  me: Me | null;
  settings: Settings | null;
  ready: boolean;
  /** Bumped after changes so open pages know to reload. */
  version: number;
  bump: () => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], title: string, body?: string) => void;
  dismiss: (id: number) => void;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  saveSettings: (p: Record<string, unknown>) => Promise<Settings | null>;
  /** Celebrate a rewarding API response: confetti, sound, voice, toasts. */
  celebrate: (res: { celebrate?: boolean; allDone?: boolean; rewards?: Rewards | null; summary?: { message: string } }, opts?: { origin?: { x: number; y: number } }) => void;
  say: (text: string, force?: boolean) => void;
  /** Tell the store the current level so a later level-up can be detected. */
  noteLevel: (level: number) => void;
}

const AppCtx = createContext<Ctx>(null as never);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastLevel = useRef<number | null>(null);
  const nextId = useRef(1);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((kind: Toast['kind'], title: string, body?: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, title, body }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4200);
  }, [dismiss]);

  const refreshMe = useCallback(async () => {
    const [m, s] = await Promise.all([get<Me>('/me'), get<Settings>('/settings')]);
    setMe(m);
    setSettings(s);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    setSettings(null);
    lastLevel.current = null;
  }, []);

  const login = useCallback(async (token: string) => {
    setToken(token);
    await refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { await refreshMe(); } catch (e) { if (!(e instanceof ApiError) || e.status === 401) setToken(null); }
      }
      setReady(true);
    })();
    const onLogout = () => { setMe(null); setSettings(null); };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [refreshMe]);

  // Apply theme, accent and the "animations off" preference to the page.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings?.theme ?? 'dark';
    root.dataset.accent = settings?.accent ?? 'purple';
    root.classList.toggle('no-anim', settings?.animations === false);
  }, [settings?.theme, settings?.accent, settings?.animations]);

  const saveSettings = useCallback(async (p: Record<string, unknown>) => {
    try {
      const s = await patch<Settings>('/settings', p);
      setSettings(s);
      return s;
    } catch (e) {
      toast('error', 'Couldn’t save settings', e instanceof Error ? e.message : undefined);
      return null;
    }
  }, [toast]);

  const say = useCallback((text: string, force = false) => { if (settings) speak(text, settings.voice, force); }, [settings]);

  const celebrate: Ctx['celebrate'] = useCallback((res, opts) => {
    if (!settings) return;
    const r = res.rewards;
    if (res.celebrate) {
      sparkle(settings.animations, false, opts?.origin);
      playComplete(settings.sounds);
    }
    if (res.allDone) {
      sparkle(settings.animations, true);
      playChime(settings.sounds);
      toast('reward', 'Everything planned is done. 🎉', 'Great work today. You’ve earned some rest.');
      speak('Everything planned for today is done. Great work.', settings.voice);
    }
    r?.achievements?.forEach((a) => {
      toast('reward', `Achievement unlocked: ${a.name}`, `+${a.xp} XP`);
      speak(`Achievement unlocked: ${a.name}.`, settings.voice);
    });
    if (r) {
      if (lastLevel.current !== null && r.level > lastLevel.current) {
        playLevelUp(settings.sounds);
        sparkle(settings.animations, true);
        toast('reward', `Level up! You’re now level ${r.level}`, 'New themes and avatars may have unlocked.');
        speak(`Level up! You are now level ${r.level}.`, settings.voice);
      }
      lastLevel.current = r.level;
    }
  }, [settings, toast]);

  // Only the first value is kept until a reward response updates it, so a refresh never fakes a level-up.
  const noteLevel = useCallback((n: number) => { if (lastLevel.current === null) lastLevel.current = n; }, []);

  const value = useMemo<Ctx>(
    () => ({ me, settings, ready, version, bump, toasts, toast, dismiss, login, logout, refreshMe, saveSettings, celebrate, say, noteLevel }),
    [me, settings, ready, version, bump, toasts, toast, dismiss, login, logout, refreshMe, saveSettings, celebrate, say, noteLevel],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Load data, reloading when `deps` or the global version change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => { if (my === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (my === seq.current) setError(e instanceof Error ? e.message : 'Something went wrong'); })
      .finally(() => { if (my === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);

  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
