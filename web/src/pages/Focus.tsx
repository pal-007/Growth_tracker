import { Maximize2, Minimize2, Pause, Play, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Field, Loading, PageHeader, Ring, PriorityChip } from '../components/ui';
import { useSetStatus } from '../components/Tasks';
import { get, post, type DayTask, type Settings } from '../lib/api';
import { AMBIENT, notify, playChime, sparkle, startAmbient, stopAmbient } from '../lib/fx';
import { useApp, useLoad } from '../store';

type Phase = 'work' | 'break' | 'long';
interface Saved { phase: Phase; running: boolean; endAt: number | null; remainingMs: number; taskId: number | null; done: number; plannedMin: number }
const KEY = 'levelup.focus';

interface Queue { next: DayTask | null; queue: DayTask[]; pomodoro: Settings['pomodoro'] }
interface Sessions { totals: { sessions: number; completed: number; focusMinutes: number; longestSessionMin: number } }

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export default function Focus() {
  const { me, settings, saveSettings, celebrate, toast, bump, say } = useApp();
  const q = useLoad(() => get<Queue>('/focus/queue'));
  const today = useLoad(() => get<Sessions>(`/focus/sessions?from=${me!.today}&to=${me!.today}`));
  const setStatus = useSetStatus(me!.today);

  const p = settings!.pomodoro;
  const [work, setWork] = useState(p.workMin);
  const [brk, setBrk] = useState(p.breakMin);
  const [longBrk, setLongBrk] = useState(p.longBreakMin);
  const [s, setS] = useState<Saved>(() => {
    try { const r = sessionStorage.getItem(KEY); if (r) return JSON.parse(r) as Saved; } catch { /* ignore */ }
    return { phase: 'work', running: false, endAt: null, remainingMs: p.workMin * 60_000, taskId: null, done: 0, plannedMin: p.workMin };
  });
  const [now, setNow] = useState(Date.now());
  const [full, setFull] = useState(false);
  const [ambient, setAmbient] = useState<string>(p.ambientSound ?? '');
  const finishing = useRef(false);

  useEffect(() => { sessionStorage.setItem(KEY, JSON.stringify(s)); }, [s]);
  const remaining = s.running && s.endAt ? s.endAt - now : s.remainingMs;
  const total = (s.phase === 'work' ? s.plannedMin : s.phase === 'break' ? brk : longBrk) * 60_000;
  const pctDone = total ? Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100))) : 0;
  const taskTitle = q.data ? [q.data.next, ...q.data.queue].find((t) => t?.id === s.taskId)?.title : undefined;

  // Tick. Based on timestamps so it stays accurate if the tab is throttled in the background.
  useEffect(() => {
    if (!s.running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [s.running]);

  // Ambient sound follows the timer while working.
  useEffect(() => {
    if (s.running && s.phase === 'work' && ambient) startAmbient(ambient); else stopAmbient();
    return () => stopAmbient();
  }, [s.running, s.phase, ambient]);

  const logSession = useCallback(async (actualMin: number, completed: boolean, plannedMin: number) => {
    try {
      const r = await post('/focus/sessions', { taskId: s.taskId, workMin: plannedMin, breakMin: brk, actualMin, completed });
      if (completed) celebrate(r);
      today.reload();
      bump();
    } catch (e) { toast('error', 'Couldn’t save that session', e instanceof Error ? e.message : undefined); }
  }, [s.taskId, brk, celebrate, toast, bump, today]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    if (s.phase === 'work') {
      const done = s.done + 1;
      await logSession(s.plannedMin, true, s.plannedMin);
      playChime(settings!.sounds);
      sparkle(settings!.animations);
      notify('Focus session complete', 'Nice work. Time for a break.');
      say('Focus session complete. Time for a break.');
      const long = done % p.sessionsBeforeLong === 0;
      const mins = long ? longBrk : brk;
      setS((x) => ({ ...x, phase: long ? 'long' : 'break', done, running: true, endAt: Date.now() + mins * 60_000, remainingMs: mins * 60_000 }));
    } else {
      notify('Break over', 'Ready for another session?');
      toast('info', 'Break’s over', 'Ready when you are.');
      setS((x) => ({ ...x, phase: 'work', running: false, endAt: null, remainingMs: work * 60_000, plannedMin: work }));
    }
    finishing.current = false;
  }, [s, logSession, settings, p.sessionsBeforeLong, longBrk, brk, work, say, toast]);

  useEffect(() => { if (s.running && s.endAt && now >= s.endAt) void finish(); }, [now, s, finish]);

  const start = () => setS((x) => {
    const ms = x.remainingMs > 0 ? x.remainingMs : (x.phase === 'work' ? work : brk) * 60_000;
    return { ...x, running: true, endAt: Date.now() + ms, remainingMs: ms };
  });
  const pause = () => setS((x) => ({ ...x, running: false, remainingMs: Math.max(0, (x.endAt ?? Date.now()) - Date.now()), endAt: null }));
  const resetTimer = () => { setS((x) => ({ ...x, running: false, endAt: null, phase: 'work', remainingMs: work * 60_000, plannedMin: work })); };
  const stopEarly = async () => {
    if (s.phase === 'work') {
      const elapsedMin = Math.floor((s.plannedMin * 60_000 - remaining) / 60_000);
      if (elapsedMin >= 1) await logSession(elapsedMin, false, s.plannedMin);
    }
    resetTimer();
  };
  const applyLengths = () => {
    if (s.running) return;
    setS((x) => ({ ...x, remainingMs: (x.phase === 'work' ? work : x.phase === 'break' ? brk : longBrk) * 60_000, plannedMin: work }));
  };
  const saveDefaults = async () => { await saveSettings({ pomodoro: { workMin: work, breakMin: brk, longBreakMin: longBrk, ambientSound: ambient || null } }); toast('success', 'Saved as your default'); };

  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFull = async () => {
    const next = !full;
    setFull(next);
    try { if (next) await document.documentElement.requestFullscreen?.(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* fullscreen is optional */ }
  };

  const phaseLabel = s.phase === 'work' ? 'Focus' : s.phase === 'break' ? 'Short break' : 'Long break';
  const controls = (
    <div className="flex flex-wrap justify-center gap-2">
      {s.running ? <button className="btn btn-primary" onClick={pause}><Pause size={16} />Pause</button> : <button className="btn btn-primary" onClick={start}><Play size={16} />{remaining < total && remaining > 0 ? 'Resume' : 'Start'}</button>}
      {(s.running || remaining < total) && <button className="btn" onClick={stopEarly}><Square size={16} />{s.phase === 'work' ? 'End session' : 'Skip break'}</button>}
      <button className="btn" onClick={resetTimer} aria-label="Reset timer"><RotateCcw size={16} /></button>
      <button className="btn" onClick={toggleFull}>{full ? <><Minimize2 size={16} />Exit</> : <><Maximize2 size={16} />Focus screen</>}</button>
    </div>
  );

  const next = q.data?.next ?? null;
  const focusTask = q.data ? [q.data.next, ...q.data.queue].find((t) => t?.id === s.taskId) ?? next : null;

  return (
    <div>
      <PageHeader title="Focus Timer" sub="Work in focused blocks with real breaks. Finishing a session earns XP." />
      <div className="grid lg:grid-cols-5 gap-6">
        <section className="glass p-6 lg:col-span-3 flex flex-col items-center gap-5" aria-label="Timer">
          <div className="chip" style={{ color: s.phase === 'work' ? 'var(--a1)' : 'var(--good)' }}>{phaseLabel} · session {s.done + (s.phase === 'work' ? 1 : 0)}</div>
          <Ring percent={pctDone} size={260} stroke={16} label={<span className="text-sm">{phaseLabel}</span>}
            sub={<div className="display text-5xl font-bold tabular-nums mt-1" aria-live="off">{fmt(remaining)}</div>} />
          {taskTitle && <p className="text-sm muted">Working on <strong className="text-[var(--text)]">{taskTitle}</strong></p>}
          {controls}
          <p className="text-xs muted text-center max-w-sm">The timer keeps its place if you switch pages, but it only counts while this tab stays open.</p>
        </section>

        <div className="lg:col-span-2 space-y-4">
          <section className="glass p-5" aria-label="Next priority">
            <h2 className="font-semibold mb-3">What to focus on</h2>
            {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data ? <Loading rows={2} /> : q.data.queue.length === 0 ? (
              <Empty emoji="✅" title="Nothing open today" body="Everything planned is done or skipped. Add a task, or enjoy the break." />
            ) : (
              <ul className="space-y-2">
                {q.data.queue.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: s.taskId === t.id || (!s.taskId && i === 0) ? 'color-mix(in srgb, var(--a1) 18%, var(--faint))' : 'var(--faint)' }}>
                    <button className="flex-1 text-left min-w-0" onClick={() => setS((x) => ({ ...x, taskId: t.id }))} aria-pressed={s.taskId === t.id}>
                      <div className="text-sm font-medium truncate">{i === 0 && <span className="chip mr-2">Next</span>}{t.title}</div>
                      <div className="text-xs muted mt-0.5 flex gap-2"><PriorityChip p={t.priority} />{t.durationMin ? `${t.durationMin} min` : ''}</div>
                    </button>
                    <button className="btn btn-sm" onClick={(e) => setStatus(t, 'completed', e).then(() => q.reload())} aria-label={`Mark ${t.title} done`}>Done</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass p-5" aria-label="Timer settings">
            <h2 className="font-semibold mb-3">Timer settings</h2>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Focus (min)"><input type="number" min={1} max={180} className="input" value={work} onChange={(e) => setWork(Number(e.target.value))} onBlur={applyLengths} /></Field>
              <Field label="Break (min)"><input type="number" min={1} max={60} className="input" value={brk} onChange={(e) => setBrk(Number(e.target.value))} onBlur={applyLengths} /></Field>
              <Field label="Long (min)"><input type="number" min={1} max={90} className="input" value={longBrk} onChange={(e) => setLongBrk(Number(e.target.value))} onBlur={applyLengths} /></Field>
            </div>
            <Field label="Ambient sound (while focusing)" className="mt-3">
              <div className="flex items-center gap-2"><Volume2 size={16} className="muted" /><select className="input" value={ambient} onChange={(e) => setAmbient(e.target.value)}><option value="">Off</option>{AMBIENT.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
            </Field>
            <button className="btn btn-sm mt-3" onClick={saveDefaults}>Save as my default</button>
          </section>

          <section className="glass p-5" aria-label="Today's focus">
            <h2 className="font-semibold mb-2">Today</h2>
            {today.data ? <div className="grid grid-cols-3 text-center gap-2">
              <div><div className="text-2xl font-bold">{today.data.totals.completed}</div><div className="text-xs muted">sessions</div></div>
              <div><div className="text-2xl font-bold">{today.data.totals.focusMinutes}</div><div className="text-xs muted">minutes</div></div>
              <div><div className="text-2xl font-bold">{today.data.totals.longestSessionMin}</div><div className="text-xs muted">longest</div></div>
            </div> : <Loading rows={1} />}
          </section>
        </div>
      </div>

      {full && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-6 text-center" style={{ background: 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--a1) 25%, var(--bg)), var(--bg))' }} role="dialog" aria-label="Focus screen">
          <div className="flex flex-col items-center gap-6">
            <div className="chip">{phaseLabel}</div>
            <div className="display font-bold tabular-nums" style={{ fontSize: 'clamp(4rem, 18vw, 11rem)', lineHeight: 1 }}>{fmt(remaining)}</div>
            <div className="w-72 max-w-full"><div className="progress-track"><div className="progress-bar" style={{ width: `${pctDone}%` }} /></div></div>
            <p className="text-xl muted">{focusTask ? <>Now: <strong className="text-[var(--text)]">{focusTask.title}</strong></> : 'Pick a task, or just focus.'}</p>
            {controls}
          </div>
        </div>
      )}
    </div>
  );
}
