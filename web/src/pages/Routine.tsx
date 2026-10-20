import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHeader, Ring } from '../components/ui';
import { DeleteTask, TaskForm, TaskRow } from '../components/Tasks';
import { get, post, type DaySummary, type DayTask } from '../lib/api';
import { addDays, fmtLong } from '../lib/dates';
import { useApp, useLoad } from '../store';

interface Day { date: string; summary: DaySummary; tasks: DayTask[] }

export default function Routine() {
  const { me, toast, bump } = useApp();
  const [date, setDate] = useState(me!.today);
  const { data, error, loading, reload, setData } = useLoad(() => get<Day>(`/days/${date}`), [date]);
  const [editing, setEditing] = useState<DayTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<DayTask | null>(null);
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [prio, setPrio] = useState('');
  const [quick, setQuick] = useState('');
  const dragId = useRef<number | null>(null);

  const isToday = date === me!.today;
  const filtered = useMemo(
    () => (data?.tasks ?? []).filter((t) => (!cat || t.category === cat) && (!status || t.status === status) && (!prio || t.priority === prio)),
    [data, cat, status, prio],
  );
  const cats = useMemo(() => [...new Set((data?.tasks ?? []).map((t) => t.category))], [data]);
  const filtering = !!(cat || status || prio);

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    try {
      const r = await post('/tasks/quick', { text: quick });
      toast('success', `Added “${r.task.title}”`);
      setQuick('');
      bump();
    } catch (err) { toast('error', 'Couldn’t add that', err instanceof Error ? err.message : undefined); }
  };

  // Drag to reorder (changes the order everywhere, since order belongs to the task itself).
  const drop = async (overId: number) => {
    const from = dragId.current;
    dragId.current = null;
    if (!data || from == null || from === overId) return;
    const ids = data.tasks.map((t) => t.id);
    ids.splice(ids.indexOf(overId), 0, ids.splice(ids.indexOf(from), 1)[0]);
    setData({ ...data, tasks: ids.map((id) => data.tasks.find((t) => t.id === id)!) });
    try { await post('/tasks/reorder', { ids }); } catch { toast('error', 'Couldn’t save the new order'); reload(); }
  };

  const goto = (n: number) => setDate((d) => addDays(d, n));

  return (
    <div>
      <PageHeader title="My Routine" sub="Plan, schedule and check off your day."
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Add task</button>} />

      <div className="glass p-3 flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button className="btn btn-icon" onClick={() => goto(-1)} aria-label="Previous day"><ChevronLeft size={18} /></button>
          <div className="text-center min-w-[11rem]"><div className="font-semibold">{fmtLong(date)}</div><div className="text-xs muted">{isToday ? 'Today' : date > me!.today ? 'Upcoming' : 'Past day'}</div></div>
          <button className="btn btn-icon" onClick={() => goto(1)} aria-label="Next day"><ChevronRight size={18} /></button>
          {!isToday && <button className="btn btn-sm" onClick={() => setDate(me!.today)}>Today</button>}
          <input type="date" className="input !w-auto !py-1.5" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a date" />
        </div>
        {data && data.summary.planned > 0 && <div className="flex items-center gap-3"><Ring percent={data.summary.completionPercent} size={64} stroke={7} /><div className="text-sm"><div className="font-semibold">{data.summary.completed}/{data.summary.planned} done</div><div className="text-xs muted max-w-[14rem]">{data.summary.message}</div></div></div>}
      </div>

      <form className="flex gap-2 mb-4" onSubmit={quickAdd}>
        <div className="relative flex-1"><Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 muted" aria-hidden />
          <input className="input !pl-9" placeholder="Quick add: “gym at 6am tomorrow for 45 minutes high priority”" value={quick} onChange={(e) => setQuick(e.target.value)} aria-label="Quick add a task" /></div>
        <button className="btn" disabled={!quick.trim()}>Add</button>
      </form>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filters">
        <select className="input !w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select>
        <select className="input !w-auto" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority"><option value="">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        {filtering && <button className="btn btn-sm" onClick={() => { setCat(''); setStatus(''); setPrio(''); }}>Clear filters</button>}
      </div>

      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading /> : filtered.length === 0 ? (
        filtering ? <Empty emoji="🔍" title="No tasks match these filters" /> :
        <Empty emoji="📝" title={isToday ? 'Your day is a blank page' : 'Nothing on this day'} body="Add a task, set when it repeats, and watch the checkbox light up when you finish it." action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add your first task</button>} />
      ) : (
        <div className="space-y-2 stagger" style={loading ? { opacity: 0.7 } : undefined}>
          {filtered.map((t) => (
            <TaskRow key={t.id} task={t} date={date} onEdit={setEditing} onDelete={setDeleting}
              dragProps={filtering ? undefined : { draggable: true, onDragStart: () => { dragId.current = t.id; }, onDragOver: (e) => e.preventDefault(), onDrop: () => void drop(t.id) }} />
          ))}
          {!filtering && filtered.length > 1 && <p className="text-xs muted text-center pt-1">Drag a task by its handle to reorder.</p>}
        </div>
      )}

      <TaskForm open={adding} onClose={() => setAdding(false)} defaults={{ startDate: date }} />
      <TaskForm open={!!editing} task={editing} onClose={() => setEditing(null)} />
      <DeleteTask task={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
