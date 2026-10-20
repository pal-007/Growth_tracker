import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GrowthReport, type Report } from '../components/Report';
import { ErrorBox, Loading, PageHeader, ProgressBar } from '../components/ui';
import { get, post, type Goal } from '../lib/api';
import { addDays, fmtShort, fmtWeekday, startOfWeek } from '../lib/dates';
import { useApp, useLoad } from '../store';

interface Review {
  weekStart: string; weekEnd: string; report: Report;
  plannedVsCompleted: { date: string; planned: number; completed: number; skipped: number; hasData: boolean }[];
  goalProgress: { id: number; title: string; status: Goal['status']; progressPercent: number | null }[];
  mostMeaningfulAchievement: { type: string; title: string } | null;
  reflections: { date: string; text: string }[];
  nextWeek: { weekStart: string };
}

const tip = { background: 'var(--card-solid)', border: '1px solid var(--card-border)', borderRadius: 12, color: 'var(--text)' };

export default function Review() {
  const { me, settings, toast, bump } = useApp();
  const thisWeek = startOfWeek(me!.today, settings!.weekStart);
  const [week, setWeek] = useState(thisWeek);
  const { data, error, reload } = useLoad(() => get<Review>(`/review/weekly?weekStart=${week}`), [week]);
  const [picks, setPicks] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ title: string; date: string }[]>([]);

  const planWeek = addDays(week, 7);
  const submit = async () => {
    const priorities = picks.map((t) => t.trim()).filter(Boolean).map((title) => ({ title }));
    if (!priorities.length) { toast('info', 'Write at least one priority first.'); return; }
    setBusy(true);
    try {
      const r = await post('/review/weekly/priorities', { weekStart: planWeek, priorities });
      setCreated(r.created);
      setPicks(['', '', '']);
      toast('success', 'Added to next week’s plan');
      bump();
    } catch (e) { toast('error', 'Couldn’t add them', e instanceof Error ? e.message : undefined); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Weekly Review" sub="Look back honestly, then choose what matters next."
        actions={<div className="glass !rounded-xl flex items-center gap-1 p-1">
          <button className="btn btn-icon" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="px-2 text-sm font-semibold">{fmtShort(week)} – {fmtShort(addDays(week, 6))}</span>
          <button className="btn btn-icon" onClick={() => setWeek(addDays(week, 7))} disabled={week >= thisWeek} aria-label="Next week"><ChevronRight size={18} /></button>
          {week !== thisWeek && <button className="btn btn-sm" onClick={() => setWeek(thisWeek)}>This week</button>}
        </div>} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading rows={3} /> : (
        <>
          {data.mostMeaningfulAchievement && (
            <section className="glass p-5 flex items-center gap-4" style={{ borderColor: 'var(--a1)' }} aria-label="Most meaningful achievement">
              <Trophy size={32} style={{ color: 'var(--warn)' }} />
              <div><div className="text-xs muted uppercase font-semibold tracking-wide">Most meaningful achievement</div><div className="display text-xl font-semibold">{data.mostMeaningfulAchievement.title}</div></div>
            </section>
          )}
          <section className="glass p-5" aria-label="Planned versus completed">
            <h2 className="font-semibold mb-3">Planned vs completed</h2>
            <div style={{ height: 230 }}><ResponsiveContainer><BarChart data={data.plannedVsCompleted.map((d) => ({ day: fmtWeekday(d.date), Planned: d.planned, Completed: d.completed, Skipped: d.skipped }))}><CartesianGrid vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip contentStyle={tip} cursor={{ fill: "var(--faint)" }} /><Legend /><Bar dataKey="Planned" fill="var(--muted)" radius={[6, 6, 0, 0]} /><Bar dataKey="Completed" fill="var(--a1)" radius={[6, 6, 0, 0]} /><Bar dataKey="Skipped" fill="var(--a2)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </section>
          <section className="glass p-5" aria-label="Report"><GrowthReport r={data.report} /></section>
          <div className="grid lg:grid-cols-2 gap-6">
            <section className="glass p-5" aria-label="Goal progress"><h2 className="font-semibold mb-3">Progress toward goals</h2>
              {data.goalProgress.length ? <ul className="space-y-3">{data.goalProgress.map((g) => <li key={g.id}><div className="flex justify-between text-sm"><span>{g.title}</span><span className="muted">{g.progressPercent === null ? 'no measure yet' : `${g.progressPercent}%`}</span></div><ProgressBar value={g.progressPercent} label={g.title} className="mt-1" /></li>)}</ul> : <p className="text-sm muted">No active goals. <Link to="/goals" className="underline">Set one</Link>.</p>}
            </section>
            <section className="glass p-5" aria-label="Lessons learned"><h2 className="font-semibold mb-3">What I learned</h2>
              {data.reflections.length ? <ul className="space-y-2">{data.reflections.map((r) => <li key={r.date} className="text-sm"><span className="muted">{fmtShort(r.date)}:</span> {r.text}</li>)}</ul> : <p className="text-sm muted">No lessons written this week. Add “What did I learn?” in your <Link to="/journal" className="underline">journal</Link>.</p>}
            </section>
          </div>
          <section className="glass p-5" aria-label="Plan next week">
            <h2 className="font-semibold">Pick up to three priorities for the week of {fmtShort(planWeek)}</h2>
            <p className="text-sm muted mb-3">Each becomes a high-priority task, spread across the week. You can reschedule them in My Routine.</p>
            <div className="grid md:grid-cols-3 gap-3">{picks.map((v, i) => <input key={i} className="input" placeholder={`Priority ${i + 1}`} value={v} onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Priority ${i + 1}`} maxLength={200} />)}</div>
            <button className="btn btn-primary mt-3" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add to my plan'}</button>
            {created.length > 0 && <div className="mt-4 text-sm"><p className="font-semibold">Scheduled:</p><ul className="mt-1">{created.map((c) => <li key={c.title + c.date}>✅ {c.title} <span className="muted">on {fmtShort(c.date)}</span></li>)}</ul><Link to="/routine" className="btn btn-sm mt-2">Open My Routine</Link></div>}
          </section>
        </>
      )}
    </div>
  );
}
