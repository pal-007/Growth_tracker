import { Flame, Plus } from 'lucide-react';
import { useState } from 'react';
import { Empty, ErrorBox, Loading, PageHeader, ProgressBar, catIcon } from '../components/ui';
import { DeleteTask, TaskForm, repeatLabel, useSetStatus } from '../components/Tasks';
import { get, type Task } from '../lib/api';
import { fmtWeekday } from '../lib/dates';
import { useApp, useLoad } from '../store';

interface Habit extends Task {
  streak: { current: number; best: number };
  last7Days: { date: string; mark: 'completed' | 'skipped' | 'missed' | 'pending' | 'not_scheduled' }[];
  last30Days: { scheduled: number; completed: number; skipped: number; completionPercent: number | null };
}

const markStyle: Record<Habit['last7Days'][number]['mark'], { bg: string; label: string }> = {
  completed: { bg: 'linear-gradient(135deg,var(--a1),var(--a2))', label: 'Done' },
  skipped: { bg: 'var(--muted)', label: 'Skipped' },
  missed: { bg: 'color-mix(in srgb, var(--bad) 45%, transparent)', label: 'Missed' },
  pending: { bg: 'var(--faint)', label: 'Open' },
  not_scheduled: { bg: 'transparent', label: 'Not scheduled' },
};

export default function Habits() {
  const { me } = useApp();
  const { data, error, reload } = useLoad(() => get<Habit[]>('/habits'));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const setToday = useSetStatus(me!.today);

  return (
    <div>
      <PageHeader title="Habits" sub="Small things, done again and again. Skipped days never break your streak by themselves."
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} />New habit</button>} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading /> : data.length === 0 ? (
        <Empty emoji="🔥" title="No habits yet" body="A habit is a repeating task you want to keep up. Create one and your streak starts with the first check-in." action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Create a habit</button>} />
      ) : (
        <div className="grid md:grid-cols-2 gap-4 stagger">
          {data.map((h) => {
            const today = h.last7Days[h.last7Days.length - 1];
            const canToggleToday = today.mark !== 'not_scheduled';
            return (
              <article key={h.id} className="glass glass-hover p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-semibold text-lg">{catIcon(h.category)} {h.title}</h3><p className="text-xs muted mt-0.5">{repeatLabel(h) || 'One time'}{h.scheduledTime ? ` · ${h.scheduledTime}` : ''}</p></div>
                  <div className="text-right"><div className="flex items-center gap-1 justify-end font-bold text-xl"><Flame size={18} style={{ color: 'var(--warn)' }} />{h.streak.current}</div><div className="text-[11px] muted">best {h.streak.best}</div></div>
                </div>
                <div className="flex justify-between mt-4" aria-label="Last 7 days">
                  {h.last7Days.map((d, i) => (
                    <div key={d.date} className="text-center">
                      <div className="text-[10px] muted mb-1">{fmtWeekday(d.date)}</div>
                      <button disabled={d.mark === 'not_scheduled' || i !== 6} title={`${d.date}: ${markStyle[d.mark].label}`} aria-label={`${fmtWeekday(d.date)}: ${markStyle[d.mark].label}`}
                        className="w-9 h-9 rounded-xl border grid place-items-center text-white text-sm" style={{ background: markStyle[d.mark].bg, borderColor: 'var(--card-border)', borderStyle: d.mark === 'not_scheduled' ? 'dashed' : 'solid', cursor: i === 6 && canToggleToday ? 'pointer' : 'default' }}
                        onClick={(e) => { if (i === 6) void setToday(h, d.mark === 'completed' ? 'not_started' : 'completed', e).then(reload); }}>
                        {d.mark === 'completed' ? '✓' : ''}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs muted mb-1"><span>Last 30 days</span><span>{h.last30Days.completionPercent === null ? 'Not enough data yet' : `${h.last30Days.completed}/${h.last30Days.scheduled} (${h.last30Days.completionPercent}%)`}</span></div>
                  <ProgressBar value={h.last30Days.completionPercent} label={`${h.title} consistency`} />
                </div>
                <div className="flex gap-2 mt-4"><button className="btn btn-sm" onClick={() => setEditing(h)}>Edit</button><button className="btn btn-sm btn-danger" onClick={() => setDeleting(h)}>Delete</button></div>
              </article>
            );
          })}
        </div>
      )}
      <TaskForm open={adding} onClose={() => setAdding(false)} defaults={{ isHabit: true, repeatType: 'daily' }} onSaved={reload} />
      <TaskForm open={!!editing} task={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <DeleteTask task={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
