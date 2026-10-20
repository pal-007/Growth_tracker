import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GrowthReport, type Report } from '../components/Report';
import { Empty, ErrorBox, Loading, PageHeader, ProgressBar, StatCard, catIcon } from '../components/ui';
import { get } from '../lib/api';
import { DAY_NAMES, addDays, fmtShort, weekday } from '../lib/dates';
import { useApp, useLoad } from '../store';
import { Flame, Target, TrendingUp } from 'lucide-react';

interface Day { date: string; planned: number; completed: number; skipped: number; unresolved: number; completionPercent: number | null; hasData: boolean; future: boolean }
interface Tot { daysWithData: number; daysWithoutData: number; planned: number; completed: number; skipped: number; unresolved: number; completionPercent: number | null }
interface Data {
  range: { from: string; to: string }; days: Day[]; totals: Tot; previousPeriod: { totals: Tot };
  comparison: { available: false; note: string } | { available: true; currentPercent: number; previousPercent: number; deltaPoints: number; direction: string };
  weekly: (Tot & { weekStart: string })[]; monthly: (Tot & { month: string })[];
  byCategory: { category: string; planned: number; completed: number; minutesCompleted: number; completionPercent: number | null }[];
  byWeekday: { weekday: number; name: string; daysWithData: number; completionPercent: number | null }[];
  bestDay: { name: string; completionPercent: number } | null; hardestDay: { name: string; completionPercent: number } | null;
  mostConsistent: { taskId: number; title: string; category: string; planned: number; completed: number; completionPercent: number | null }[];
  frequentlyMissed: { taskId: number; title: string; planned: number; missed: number }[];
  goals: { total: number; completed: number; inProgress: number; paused: number; notStarted: number; completionRatePercent: number | null };
  streak: { current: number; best: number }; milestonesAchieved: { date: string; name: string }[];
  commonDifficulties: { date: string; difficult: string; distracted: string }[];
}

const tip = { background: 'var(--card-solid)', border: '1px solid var(--card-border)', borderRadius: 12, color: 'var(--text)' };

function Heatmap({ days, weekStart }: { days: Day[]; weekStart: number }) {
  const lead = (weekday(days[0].date) - weekStart + 7) % 7;
  const cells: (Day | null)[] = [...Array(lead).fill(null), ...days];
  const level = (d: Day) => (!d.hasData ? undefined : d.completionPercent === 0 ? '0' : d.completionPercent! <= 25 ? '1' : d.completionPercent! <= 50 ? '2' : d.completionPercent! <= 75 ? '3' : '4');
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-[10px] muted text-center mb-1">{Array.from({ length: 7 }, (_, i) => <span key={i}>{DAY_NAMES[(weekStart + i) % 7]}</span>)}</div>
      <div className="grid grid-cols-7 gap-1.5" role="img" aria-label="Calendar heatmap of daily completion">
        {cells.map((d, i) => d ? <div key={d.date} className="heat" data-l={level(d)} style={d.future ? { opacity: 0.35 } : undefined}
          title={`${fmtShort(d.date)}: ${d.hasData ? `${d.completed}/${d.planned} done (${d.completionPercent}%)` : d.future ? 'Upcoming' : d.planned ? 'Before tracking began' : 'Nothing planned'}`} /> : <div key={`e${i}`} />)}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs muted mt-3">
        <span className="flex items-center gap-1"><span className="heat !w-3 !h-3" />No data</span>
        <span className="flex items-center gap-1"><span className="heat !w-3 !h-3" data-l="0" />0%</span>
        {['1', '2', '3', '4'].map((l) => <span key={l} className="flex items-center gap-1"><span className="heat !w-3 !h-3" data-l={l} />{['1–25', '26–50', '51–75', '76–100'][Number(l) - 1]}%</span>)}
      </div>
    </div>
  );
}

export default function Analytics() {
  const { settings, me } = useApp();
  const [span, setSpan] = useState(30);
  const [period, setPeriod] = useState<'weekly' | 'daily'>('weekly');
  const { data, error, reload } = useLoad(() => get<Data>(`/analytics?from=${addDays(me!.today, -(span - 1))}`), [span]);
  const report = useLoad(() => get<Report>(`/reports/${period}`), [period]);

  const chartDays = data?.days.map((d) => ({ date: fmtShort(d.date), percent: d.completionPercent, completed: d.completed, planned: d.planned }));
  const noData = data && data.totals.daysWithData === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Growth Analytics" sub="Everything here is calculated from your own saved records. Missing data stays blank, never invented."
        actions={<div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--faint)' }} role="group" aria-label="Range">{[14, 30, 90, 180].map((n) => <button key={n} aria-pressed={span === n} className={`btn btn-sm !border-0 ${span === n ? 'btn-primary' : '!bg-transparent'}`} onClick={() => setSpan(n)}>{n} days</button>)}</div>} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading rows={4} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
            <StatCard icon={<Target size={14} />} label="Completion" value={data.totals.completionPercent === null ? '–' : `${data.totals.completionPercent}%`} sub={`${data.totals.completed} of ${data.totals.planned} planned tasks`} />
            <StatCard icon={<TrendingUp size={14} />} label="vs previous period" value={data.comparison.available ? `${data.comparison.deltaPoints > 0 ? '+' : ''}${data.comparison.deltaPoints}` : '–'} sub={data.comparison.available ? `points (was ${data.comparison.previousPercent}%)` : data.comparison.note} />
            <StatCard icon={<Flame size={14} />} label="Streak" value={`${data.streak.current} days`} sub={`Best: ${data.streak.best} days`} />
            <StatCard icon={<Target size={14} />} label="Goals completed" value={data.goals.completionRatePercent === null ? '–' : `${data.goals.completionRatePercent}%`} sub={`${data.goals.completed} of ${data.goals.total} goals`} />
          </div>

          {noData ? <Empty emoji="📈" title="Not enough data yet" body="Complete or skip a few tasks and your charts will fill in. Days with nothing tracked stay blank." /> : (
            <>
              <section className="glass p-5" aria-label="Daily completion">
                <h2 className="font-semibold mb-1">Daily completion</h2>
                <p className="text-xs muted mb-3">Gaps mean no data for that day (nothing planned, or before you started tracking).</p>
                <div style={{ height: 260 }}><ResponsiveContainer><LineChart data={chartDays}><CartesianGrid vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} /><YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} width={44} /><Tooltip contentStyle={tip} cursor={{ fill: "var(--faint)" }} formatter={(v) => (v === null || v === undefined ? 'No data' : `${v}%`)} /><Line type="monotone" dataKey="percent" name="Completion" stroke="var(--a1)" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} isAnimationActive /></LineChart></ResponsiveContainer></div>
              </section>

              <div className="grid lg:grid-cols-2 gap-6">
                <section className="glass p-5" aria-label="Weekly performance"><h2 className="font-semibold mb-3">Weekly performance</h2>
                  <div style={{ height: 240 }}><ResponsiveContainer><BarChart data={data.weekly.filter((w) => w.daysWithData > 0).map((w) => ({ week: fmtShort(w.weekStart), Planned: w.planned, Completed: w.completed, Skipped: w.skipped }))}><CartesianGrid vertical={false} /><XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} /><Tooltip contentStyle={tip} cursor={{ fill: "var(--faint)" }} /><Legend /><Bar dataKey="Planned" fill="var(--muted)" radius={[6, 6, 0, 0]} /><Bar dataKey="Completed" fill="var(--a1)" radius={[6, 6, 0, 0]} /><Bar dataKey="Skipped" fill="var(--a2)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
                </section>
                <section className="glass p-5" aria-label="Best days"><h2 className="font-semibold mb-1">Best-performing days</h2>
                  <p className="text-xs muted mb-3">{data.bestDay ? `${data.bestDay.name} is your strongest day (${data.bestDay.completionPercent}%).${data.hardestDay && data.hardestDay.name !== data.bestDay.name ? ` ${data.hardestDay.name} is the hardest (${data.hardestDay.completionPercent}%).` : ''}` : 'Needs at least two tracked days per weekday to compare.'}</p>
                  <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={data.byWeekday.map((w) => ({ name: w.name, percent: w.completionPercent }))}><CartesianGrid vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} width={44} /><Tooltip contentStyle={tip} cursor={{ fill: "var(--faint)" }} formatter={(v) => (v === null || v === undefined ? 'No data' : `${v}%`)} /><Bar dataKey="percent" name="Completion" fill="var(--a2)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
                </section>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <section className="glass p-5" aria-label="Heatmap"><h2 className="font-semibold mb-3">Calendar heatmap</h2><Heatmap days={data.days} weekStart={settings!.weekStart} /></section>
                <section className="glass p-5" aria-label="Time by category"><h2 className="font-semibold mb-3">Time spent by category</h2>
                  {data.byCategory.some((c) => c.minutesCompleted > 0) ? <div style={{ height: 250 }}><ResponsiveContainer><BarChart layout="vertical" data={data.byCategory.filter((c) => c.minutesCompleted > 0).map((c) => ({ name: `${catIcon(c.category)} ${c.category}`, minutes: c.minutesCompleted }))}><CartesianGrid horizontal={false} /><XAxis type="number" unit=" min" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} /><Tooltip contentStyle={tip} cursor={{ fill: "var(--faint)" }} /><Bar dataKey="minutes" fill="var(--a1)" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>
                    : <p className="text-sm muted">Add estimated durations to your tasks to see time by category.</p>}
                  <div className="mt-3 space-y-2">{data.byCategory.map((c) => <div key={c.category}><div className="flex justify-between text-xs"><span>{catIcon(c.category)} {c.category}</span><span className="muted">{c.completed}/{c.planned}</span></div><ProgressBar value={c.completionPercent} label={c.category} className="!h-1.5" /></div>)}</div>
                </section>
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                <section className="glass p-5"><h2 className="font-semibold mb-3">Most consistent</h2>{data.mostConsistent.length ? <ul className="space-y-2">{data.mostConsistent.map((t) => <li key={t.taskId} className="text-sm"><div className="flex justify-between"><span>{t.title}</span><span className="muted">{t.completionPercent}%</span></div><ProgressBar value={t.completionPercent} className="!h-1.5" label={t.title} /></li>)}</ul> : <p className="text-sm muted">Needs a task with at least 3 tracked days.</p>}</section>
                <section className="glass p-5"><h2 className="font-semibold mb-3">Often missed</h2>{data.frequentlyMissed.length ? <ul className="space-y-2">{data.frequentlyMissed.map((t) => <li key={t.taskId} className="flex justify-between text-sm"><span>{t.title}</span><span className="muted">{t.missed}× open</span></li>)}</ul> : <p className="text-sm muted">Nothing is being repeatedly missed. 🎉</p>}</section>
                <section className="glass p-5"><h2 className="font-semibold mb-3">Milestones and difficulties</h2>
                  {data.milestonesAchieved.slice(-3).map((m) => <p key={m.name} className="text-sm">🏅 {m.name} <span className="muted">· {fmtShort(m.date)}</span></p>)}
                  {data.commonDifficulties.slice(0, 3).map((d) => <p key={d.date} className="text-sm mt-1"><span className="muted">{fmtShort(d.date)}:</span> {d.difficult || d.distracted}</p>)}
                  {!data.milestonesAchieved.length && !data.commonDifficulties.length && <p className="text-sm muted">Achievements and journal notes will show up here.</p>}
                </section>
              </div>
            </>
          )}
        </>
      )}

      <section className="glass p-5" aria-label="Growth report">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4"><h2 className="font-semibold text-lg">Growth report</h2>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--faint)' }}>{(['daily', 'weekly'] as const).map((p) => <button key={p} aria-pressed={period === p} className={`btn btn-sm !border-0 ${period === p ? 'btn-primary' : '!bg-transparent'}`} onClick={() => setPeriod(p)}>{p === 'daily' ? 'Today' : 'This week'}</button>)}</div></div>
        {report.error ? <ErrorBox message={report.error} onRetry={report.reload} /> : !report.data ? <Loading rows={2} /> : <GrowthReport r={report.data} />}
      </section>
    </div>
  );
}
