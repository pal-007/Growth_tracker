import { ArrowDownRight, ArrowUpRight, Equal } from 'lucide-react';

export interface Report {
  label: string; from: string; to: string; summary: string;
  dataQuality: { daysWithData: number; daysWithoutData: number; note: string };
  accomplished: { tasksCompleted: number; tasksPlanned: number; tasksSkipped: number; completionPercent: number | null; minutesCompleted: number; focusSessions: number; focusMinutes: number; goalsCompleted: string[]; milestonesReached: number };
  improvedVsPrevious: { available: false; note: string } | { available: true; currentPercent: number; previousPercent: number; deltaPoints: number; direction: 'up' | 'down' | 'same' };
  consistentHabits: { taskId: number; title: string; completed: number; planned: number; completionPercent: number | null }[];
  frequentlyPostponed: { taskId: number; title: string; missed: number; planned: number }[];
  obstacles: { daysReported: number; entries: { date: string; kind: 'difficult' | 'distracted'; text: string }[] };
  nextImprovement: string;
  lessonsLearned: { date: string; text: string }[];
}

const Q = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl p-4" style={{ background: 'var(--faint)' }}>
    <h3 className="font-semibold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-full grad-bg text-white text-xs grid place-items-center">{n}</span>{title}</h3>
    <div className="text-sm mt-2 space-y-1">{children}</div>
  </div>
);

/** The six-question growth report, always built from saved records. */
export function GrowthReport({ r }: { r: Report }) {
  const a = r.accomplished;
  const imp = r.improvedVsPrevious;
  return (
    <div className="space-y-3">
      <p className="text-base">{r.summary}</p>
      <div className="grid md:grid-cols-2 gap-3">
        <Q n={1} title="What did I accomplish?">
          {r.dataQuality.daysWithData === 0 ? <p className="muted">Nothing tracked yet in this period.</p> : <>
            <p>{a.tasksCompleted} of {a.tasksPlanned} planned tasks completed{a.tasksSkipped ? `, ${a.tasksSkipped} skipped on purpose` : ''}.</p>
            {a.minutesCompleted > 0 && <p>About {a.minutesCompleted} planned minutes of work done.</p>}
            {a.focusSessions > 0 && <p>{a.focusSessions} focus {a.focusSessions === 1 ? 'session' : 'sessions'} ({a.focusMinutes} min).</p>}
            {a.milestonesReached > 0 && <p>{a.milestonesReached} goal {a.milestonesReached === 1 ? 'milestone' : 'milestones'} reached.</p>}
            {a.goalsCompleted.map((g) => <p key={g}>🏆 Completed goal: {g}</p>)}
          </>}
        </Q>
        <Q n={2} title="What improved compared with the previous period?">
          {imp.available ? (
            <p className="flex items-center gap-2">
              {imp.direction === 'up' ? <ArrowUpRight size={18} style={{ color: 'var(--good)' }} /> : imp.direction === 'down' ? <ArrowDownRight size={18} style={{ color: 'var(--warn)' }} /> : <Equal size={18} />}
              {imp.currentPercent}% completion vs {imp.previousPercent}% before ({imp.deltaPoints > 0 ? '+' : ''}{imp.deltaPoints} points).
            </p>
          ) : <p className="muted">{imp.note}</p>}
        </Q>
        <Q n={3} title="Which habits am I keeping up?">
          {r.consistentHabits.length ? r.consistentHabits.map((h) => <p key={h.taskId}>✅ {h.title} <span className="muted">({h.completed}/{h.planned})</span></p>) : <p className="muted">No task has been done consistently enough yet. That’s normal early on.</p>}
        </Q>
        <Q n={4} title="Which tasks do I often postpone?">
          {r.frequentlyPostponed.length ? r.frequentlyPostponed.map((h) => <p key={h.taskId}>⏳ {h.title} <span className="muted">(left open {h.missed} of {h.planned})</span></p>) : <p className="muted">Nothing is being repeatedly put off.</p>}
        </Q>
        <Q n={5} title="What obstacles did I report?">
          {r.obstacles.entries.length ? r.obstacles.entries.slice(-4).map((o, i) => <p key={i}><span className="muted">{o.kind === 'difficult' ? 'Difficult' : 'Distracted'}:</span> {o.text}</p>) : <p className="muted">No obstacles noted in your journal for this period.</p>}
        </Q>
        <Q n={6} title="One realistic improvement to try next"><p>{r.nextImprovement}</p></Q>
      </div>
      <p className="text-xs muted">{r.dataQuality.note} Tracked days: {r.dataQuality.daysWithData}.</p>
    </div>
  );
}
