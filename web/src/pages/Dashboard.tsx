import { Flame, Quote, Target, Trophy, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Loading, MOODS, ProgressBar, Ring, StatCard, catIcon } from '../components/ui';
import { TaskForm, TaskRow } from '../components/Tasks';
import { get, put, type DaySummary, type DayTask, type Rewards } from '../lib/api';
import { fmtLong, fmtTime } from '../lib/dates';
import { useApp, useLoad } from '../store';

interface Dash {
  demoMode: boolean; date: string; greeting: string; today: DaySummary; topPriorities: DayTask[]; upcoming: DayTask[]; overdue: DayTask[]; timeline: DayTask[];
  streak: { current: number; best: number }; weeklyProgress: { completed: number; target: number; percent: number };
  goalsAchieved: number; level: Rewards; quote: string; reflection: { done: boolean; prompt: string };
}

function Reflection({ done }: { done: boolean }) {
  const { me, bump, celebrate, toast } = useApp();
  const [mood, setMood] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (done) {
    return (
      <div className="glass p-5">
        <h3 className="font-semibold">How was your day?</h3>
        <p className="muted text-sm mt-1">Your reflection for today is saved. Nicely done.</p>
        <Link to="/journal" className="btn btn-sm mt-3">Open journal</Link>
      </div>
    );
  }
  const save = async () => {
    if (mood == null && !note.trim()) { toast('info', 'Pick a mood or write a line first.'); return; }
    setBusy(true);
    try {
      const r = await put(`/journal/${me!.today}`, { mood, notes: note });
      celebrate({ rewards: r.rewards });
      toast('success', 'Reflection saved');
      bump();
    } catch (e) { toast('error', 'Couldn’t save', e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };
  return (
    <div className="glass p-5">
      <h3 className="font-semibold">How was your day?</h3>
      <div className="flex gap-2 mt-3" role="radiogroup" aria-label="Mood">
        {MOODS.map((m) => (
          <button key={m.v} role="radio" aria-checked={mood === m.v} aria-label={m.label} title={m.label} onClick={() => setMood(m.v)}
            className={`btn !text-2xl !p-2 ${mood === m.v ? 'btn-primary' : ''}`}>{m.emoji}</button>
        ))}
      </div>
      <textarea className="input mt-3" placeholder="One line about today (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reflection note" />
      <button className="btn btn-primary btn-sm mt-3" onClick={save} disabled={busy}>Save reflection</button>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(() => get<Dash>('/dashboard'));
  const [adding, setAdding] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading rows={4} />;
  const d = data;
  const nothing = d.today.planned === 0;
  const shown = new Set(d.topPriorities.map((t) => t.id));
  const laterOverdue = d.overdue.filter((t) => !shown.has(t.id));
  const laterUpcoming = d.upcoming.filter((t) => !shown.has(t.id) && !t.overdue);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="muted text-sm">{fmtLong(d.date)}</p>
          <h1 className="display text-3xl sm:text-4xl font-bold mt-1">{d.greeting} <span aria-hidden>👋</span></h1>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add task</button>
      </div>

      <section className="glass p-6 grid md:grid-cols-[auto_1fr] gap-6 items-center" aria-label="Today's progress" style={loading ? { opacity: 0.8 } : undefined}>
        <div className="mx-auto"><Ring percent={d.today.completionPercent} label={`${d.today.completed} of ${d.today.planned} done`} /></div>
        <div>
          <p className="display text-2xl font-semibold">{d.today.message}</p>
          {d.today.planned > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl p-3" style={{ background: 'var(--faint)' }}><div className="text-2xl font-bold">{d.today.completed}</div><div className="text-xs muted">Done</div></div>
              <div className="rounded-xl p-3" style={{ background: 'var(--faint)' }}><div className="text-2xl font-bold">{d.today.remaining}</div><div className="text-xs muted">To go</div></div>
              <div className="rounded-xl p-3" style={{ background: 'var(--faint)' }}><div className="text-2xl font-bold">{d.today.skipped}</div><div className="text-xs muted">Skipped</div></div>
            </div>
          )}
          <blockquote className="mt-4 flex gap-2 text-sm muted italic"><Quote size={16} className="shrink-0 mt-0.5" aria-hidden />{d.quote}</blockquote>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger" aria-label="Stats">
        <StatCard icon={<Flame size={14} />} label="Streak" value={<>{d.streak.current}<span className="text-base muted"> days</span></>} sub={`Best: ${d.streak.best} days`} />
        <StatCard icon={<Target size={14} />} label="This week" value={`${d.weeklyProgress.completed}/${d.weeklyProgress.target}`} sub="tasks toward your weekly goal">
          <ProgressBar value={d.weeklyProgress.percent} className="mt-2" label="Weekly goal" />
        </StatCard>
        <StatCard icon={<Trophy size={14} />} label="Goals achieved" value={d.goalsAchieved} sub="completed in total" />
        <StatCard icon={<Zap size={14} />} label={`Level ${d.level.level}`} value={`${d.level.xpIntoLevel} XP`} sub={`${d.level.xpForNextLevel - d.level.xpIntoLevel} XP to the next level`}>
          <ProgressBar value={d.level.progressPercent} className="mt-2" label="Level progress" />
        </StatCard>
      </section>

      {nothing ? (
        <Empty emoji="🗓️" title="Nothing planned for today" body="Add a few small tasks and check them off. Your progress starts with the first one." action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Plan my day</button>} />
      ) : (
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <section aria-label="Top priorities"><h2 className="font-semibold mb-2">Today’s top priorities</h2>
              {d.topPriorities.length ? <div className="space-y-2">{d.topPriorities.map((t) => <TaskRow key={t.id} task={t} date={d.date} compact />)}</div>
                : <div className="glass p-5 muted text-sm">All priorities are handled. 🎉</div>}
            </section>
            {/* Each task appears once: anything already shown above is left out of the lists below. */}
            {laterOverdue.length > 0 && (
              <section aria-label="Overdue"><h2 className="font-semibold mb-2" style={{ color: 'var(--bad)' }}>Also overdue</h2>
                <div className="space-y-2">{laterOverdue.map((t) => <TaskRow key={t.id} task={t} date={d.date} compact />)}</div></section>
            )}
            {laterUpcoming.length > 0 && (
              <section aria-label="Upcoming"><h2 className="font-semibold mb-2">Upcoming</h2>
                <div className="space-y-2">{laterUpcoming.map((t) => <TaskRow key={t.id} task={t} date={d.date} compact />)}</div></section>
            )}
          </div>
          <div className="lg:col-span-2 space-y-6">
            <section className="glass p-5" aria-label="Timeline"><h2 className="font-semibold mb-3">Your day</h2>
              <ol className="relative border-l ml-2 space-y-4" style={{ borderColor: 'var(--card-border)' }}>
                {d.timeline.map((t) => (
                  <li key={t.id} className="ml-5 relative">
                    <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full border-2" style={{ borderColor: 'var(--a1)', background: t.status === 'completed' ? 'var(--a1)' : t.status === 'skipped' ? 'var(--muted)' : 'var(--card-solid)' }} />
                    <div className="text-xs muted">{t.scheduledTime ? fmtTime(t.scheduledTime) : 'Anytime'}</div>
                    <div className={`text-sm font-medium ${t.status === 'completed' ? 'line-through muted' : ''}`}>{catIcon(t.category)} {t.title}</div>
                  </li>
                ))}
              </ol>
            </section>
            <Reflection done={d.reflection.done} />
          </div>
        </div>
      )}
      {nothing && <Reflection done={d.reflection.done} />}
      <TaskForm open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
