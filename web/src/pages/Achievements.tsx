import { Lock, Zap } from 'lucide-react';
import { AVATAR_EMOJI, ErrorBox, Loading, PageHeader, ProgressBar } from '../components/ui';
import { get, patch } from '../lib/api';
import { fmtShort } from '../lib/dates';
import { useApp, useLoad } from '../store';

interface Profile {
  level: number; xp: number; xpIntoLevel: number; xpForNextLevel: number; progressPercent: number; avatar: string;
  achievements: { key: string; name: string; description: string; unlocked: boolean; unlockedOn: string | null }[];
  challenges: { key: string; period: 'daily' | 'weekly'; title: string; progress: number; target: number; done: boolean; xp: number }[];
  streak: { current: number; best: number };
  personalBests: { mostTasksInADay: number; mostTasksInAWeek: number; bestStreakDays: number; longestFocusSessionMin: number };
  unlockables: { avatars: { key: string; level: number; unlocked: boolean }[]; themes: { key: string; level: number; unlocked: boolean }[] };
  timeline: { date: string; type: string; title: string }[];
}
const THEME_SWATCH: Record<string, string> = { purple: '#8b5cf6', ocean: '#06b6d4', sunset: '#f97316', aurora: '#10b981', ember: '#ef4444' };

export default function Achievements() {
  const { settings, saveSettings, refreshMe, toast, bump } = useApp();
  const { data, error, reload } = useLoad(() => get<Profile>('/gamification/profile'));

  const pickAvatar = async (a: string) => { try { await patch('/me', { avatar: a }); await refreshMe(); bump(); } catch (e) { toast('error', 'Locked', e instanceof Error ? e.message : undefined); } };
  const pickTheme = async (t: string) => { const s = await saveSettings({ accent: t }); if (s) bump(); };

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading rows={4} />;
  const d = data;
  const challenge = (period: 'daily' | 'weekly') => d.challenges.filter((c) => c.period === period);

  return (
    <div className="space-y-6">
      <PageHeader title="Achievements" sub="You earn XP for showing up, reflecting and coming back after a break. Never for burning out." />
      <section className="glass p-6 flex flex-wrap items-center gap-6" aria-label="Level">
        <div className="w-24 h-24 rounded-full grad-bg grid place-items-center text-5xl pulse" aria-hidden>{AVATAR_EMOJI[d.avatar] ?? '🚀'}</div>
        <div className="flex-1 min-w-[16rem]">
          <div className="display text-3xl font-bold">Level {d.level}</div>
          <div className="flex items-center gap-1 text-sm muted mt-1"><Zap size={14} />{d.xp} XP total · {d.xpForNextLevel - d.xpIntoLevel} XP to level {d.level + 1}</div>
          <ProgressBar value={d.progressPercent} className="mt-3 !h-3" label="Level progress" />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="glass p-5" aria-label="Challenges"><h2 className="font-semibold mb-3">Challenges</h2>
          {(['daily', 'weekly'] as const).map((p) => (
            <div key={p} className="mb-4 last:mb-0"><h3 className="text-xs uppercase muted font-semibold mb-2">{p === 'daily' ? 'Today' : 'This week'}</h3>
              <ul className="space-y-2">{challenge(p).map((c) => (
                <li key={c.key}><div className="flex justify-between text-sm"><span>{c.done ? '✅ ' : ''}{c.title}</span><span className="muted">{c.progress}/{c.target} · +{c.xp} XP</span></div><ProgressBar value={Math.round((c.progress / c.target) * 100)} className="mt-1 !h-1.5" label={c.title} /></li>))}</ul></div>))}
        </section>
        <section className="glass p-5" aria-label="Personal bests"><h2 className="font-semibold mb-3">Personal bests</h2>
          <div className="grid grid-cols-2 gap-3">
            {[['Most tasks in a day', d.personalBests.mostTasksInADay], ['Most in a week', d.personalBests.mostTasksInAWeek], ['Best streak (days)', d.personalBests.bestStreakDays], ['Longest focus (min)', d.personalBests.longestFocusSessionMin]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl p-4 text-center" style={{ background: 'var(--faint)' }}><div className="display text-3xl font-bold grad-text">{v}</div><div className="text-xs muted mt-1">{l}</div></div>))}
          </div>
          <p className="text-xs muted mt-3">Current streak: {d.streak.current} days. Rest days and intentional skips don’t break it.</p>
        </section>
      </div>

      <section aria-label="Badges"><h2 className="font-semibold mb-3">Badges</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 stagger">
          {d.achievements.map((a) => (
            <div key={a.key} className="glass p-4 text-center" style={{ opacity: a.unlocked ? 1 : 0.55 }}>
              <div className={`w-14 h-14 mx-auto rounded-full grid place-items-center text-2xl ${a.unlocked ? 'grad-bg' : ''}`} style={a.unlocked ? undefined : { background: 'var(--faint)' }} aria-hidden>{a.unlocked ? '🏅' : <Lock size={20} />}</div>
              <h3 className="font-semibold mt-2">{a.name}</h3><p className="text-xs muted mt-1">{a.description}</p>
              {a.unlockedOn && <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>Unlocked {fmtShort(a.unlockedOn)}</p>}
            </div>))}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="glass p-5" aria-label="Unlockables"><h2 className="font-semibold mb-3">Avatars and themes</h2>
          <div className="flex flex-wrap gap-2 mb-4">{d.unlockables.avatars.map((a) => (
            <button key={a.key} disabled={!a.unlocked} onClick={() => pickAvatar(a.key)} aria-pressed={d.avatar === a.key} aria-label={`${a.key} avatar${a.unlocked ? '' : `, unlocks at level ${a.level}`}`} className={`btn !text-2xl !p-3 ${d.avatar === a.key ? 'btn-primary' : ''}`} title={a.unlocked ? a.key : `Unlocks at level ${a.level}`}>{a.unlocked ? AVATAR_EMOJI[a.key] : '🔒'}</button>))}</div>
          <div className="flex flex-wrap gap-3">{d.unlockables.themes.map((t) => (
            <button key={t.key} disabled={!t.unlocked} onClick={() => pickTheme(t.key)} aria-pressed={settings?.accent === t.key} aria-label={`${t.key} theme${t.unlocked ? '' : `, unlocks at level ${t.level}`}`} className="flex flex-col items-center gap-1 text-xs" title={t.unlocked ? t.key : `Unlocks at level ${t.level}`}>
              <span className="w-10 h-10 rounded-full grid place-items-center border-2" style={{ background: t.unlocked ? THEME_SWATCH[t.key] : 'var(--faint)', borderColor: settings?.accent === t.key ? 'var(--text)' : 'transparent' }}>{!t.unlocked && <Lock size={14} />}</span>
              <span className="capitalize">{t.key}</span>{!t.unlocked && <span className="muted">Lv {t.level}</span>}
            </button>))}</div>
        </section>
        <section className="glass p-5" aria-label="Growth timeline"><h2 className="font-semibold mb-3">Growth timeline</h2>
          {d.timeline.length ? <ol className="relative border-l ml-2 space-y-3 max-h-72 overflow-y-auto" style={{ borderColor: 'var(--card-border)' }}>{d.timeline.map((t, i) => <li key={i} className="ml-5 relative"><span className="absolute -left-[27px] top-1.5 w-3 h-3 rounded-full grad-bg" /><div className="text-xs muted">{fmtShort(t.date)}</div><div className="text-sm">{t.title}</div></li>)}</ol>
            : <p className="text-sm muted">Achievements, finished goals and milestones will appear here as you grow.</p>}
        </section>
      </div>
    </div>
  );
}
