import { Clock, GripVertical, Pencil, Repeat, Target, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, del, get, patch, post, put, type DayTask, type Goal, type Priority, type Status, type Task } from '../lib/api';
import { DAY_NAMES, fmtTime } from '../lib/dates';
import { useApp } from '../store';
import { Checkbox, Confirm, Field, Modal, PriorityChip, catIcon } from './ui';

/** Set a task's status for a date and celebrate the result. */
export function useSetStatus(date: string, after?: () => void) {
  const { celebrate, bump, toast } = useApp();
  return async (task: { id: number; title: string }, status: Status, ev?: React.MouseEvent) => {
    try {
      const r = await put(`/days/${date}/tasks/${task.id}`, { status });
      const origin = ev ? { x: ev.clientX / window.innerWidth, y: ev.clientY / window.innerHeight } : undefined;
      celebrate(r, { origin });
      bump();
      after?.();
      return r;
    } catch (e) {
      toast('error', 'Couldn’t update that task', e instanceof Error ? e.message : undefined);
    }
  };
}

export function repeatLabel(t: Task): string {
  switch (t.repeatType) {
    case 'daily': return 'Every day';
    case 'weekly': return 'Weekly';
    case 'selected_days': return t.repeatDays.map((d) => DAY_NAMES[d]).join(', ');
    case 'custom': return `Every ${t.repeatInterval} days`;
    default: return '';
  }
}

export function TaskRow({ task, date, onEdit, onDelete, dragProps, compact }: {
  task: DayTask; date: string; onEdit?: (t: DayTask) => void; onDelete?: (t: DayTask) => void; dragProps?: React.HTMLAttributes<HTMLDivElement>; compact?: boolean;
}) {
  const setStatus = useSetStatus(date);
  const done = task.status === 'completed';
  return (
    <div className="glass glass-hover p-3.5 flex items-start gap-3" {...dragProps} style={{ opacity: task.status === 'skipped' ? 0.6 : 1 }}>
      {dragProps && <GripVertical size={18} className="muted mt-1 cursor-grab shrink-0" aria-hidden />}
      <Checkbox status={task.status} label={task.title} onToggle={(e) => setStatus(task, done ? 'not_started' : 'completed', e)} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-semibold ${done ? 'line-through muted' : ''}`}>{task.title}</span>
          {task.overdue && <span className="chip" style={{ color: 'var(--bad)' }}>Overdue</span>}
          {task.isHabit && <span className="chip">Habit</span>}
        </div>
        {!compact && task.description && <p className="text-sm muted mt-0.5">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs muted">
          <span>{catIcon(task.category)} {task.category}</span>
          {task.scheduledTime && <span className="inline-flex items-center gap-1"><Clock size={12} />{fmtTime(task.scheduledTime)}</span>}
          {task.durationMin && <span>{task.durationMin} min</span>}
          {task.repeatType !== 'none' && <span className="inline-flex items-center gap-1"><Repeat size={12} />{repeatLabel(task)}</span>}
          {task.goalId && <span className="inline-flex items-center gap-1"><Target size={12} />Goal</span>}
          <PriorityChip p={task.priority} />
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
          <select className="input !py-1 !text-xs !w-auto" value={task.status} aria-label={`Status of ${task.title}`} onChange={(e) => setStatus(task, e.target.value as Status)}>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="skipped">Skipped</option>
          </select>
          <div className="flex gap-1">
            {onEdit && <button className="btn btn-icon btn-sm" onClick={() => onEdit(task)} aria-label={`Edit ${task.title}`}><Pencil size={14} /></button>}
            {onDelete && <button className="btn btn-icon btn-sm btn-danger" onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`}><Trash2 size={14} /></button>}
          </div>
        </div>
      )}
    </div>
  );
}

const REMINDERS = [{ v: '', l: 'No reminder' }, { v: '0', l: 'At the scheduled time' }, { v: '5', l: '5 minutes before' }, { v: '10', l: '10 minutes before' }, { v: '15', l: '15 minutes before' }, { v: '30', l: '30 minutes before' }, { v: '60', l: '1 hour before' }];

export function TaskForm({ open, onClose, task, defaults, onSaved }: {
  open: boolean; onClose: () => void; task?: Task | null; defaults?: Partial<Task>; onSaved?: () => void;
}) {
  const { settings, me, toast, bump } = useApp();
  const blank = () => ({
    title: '', description: '', category: settings?.categories[0] ?? 'Personal', scheduledTime: '', reminderMinutes: '', durationMin: '',
    priority: 'medium' as Priority, repeatType: 'none' as Task['repeatType'], repeatDays: [] as number[], repeatInterval: 2,
    startDate: me?.today ?? '', endDate: '', goalId: '', isHabit: false, ...(defaults as object),
  });
  const [f, setF] = useState<ReturnType<typeof blank>>(blank());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (task) {
      setF({
        title: task.title, description: task.description, category: task.category, scheduledTime: task.scheduledTime ?? '',
        reminderMinutes: task.reminderMinutes == null ? '' : String(task.reminderMinutes), durationMin: task.durationMin ? String(task.durationMin) : '',
        priority: task.priority, repeatType: task.repeatType, repeatDays: task.repeatDays, repeatInterval: task.repeatInterval,
        startDate: task.startDate, endDate: task.endDate ?? '', goalId: task.goalId ? String(task.goalId) : '', isHabit: task.isHabit,
      });
    } else setF(blank());
    get<Goal[]>('/goals').then((g) => setGoals(g.filter((x) => x.status !== 'completed'))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleDay = (d: number) => set('repeatDays', f.repeatDays.includes(d) ? f.repeatDays.filter((x) => x !== d) : [...f.repeatDays, d].sort());

  const save = async () => {
    if (!f.title.trim()) { setErr('Give the task a name.'); return; }
    setBusy(true);
    setErr('');
    const body = {
      title: f.title.trim(), description: f.description, category: f.category, priority: f.priority,
      scheduledTime: f.scheduledTime || null, reminderMinutes: f.reminderMinutes === '' ? null : Number(f.reminderMinutes),
      durationMin: f.durationMin ? Number(f.durationMin) : null, repeatType: f.repeatType, repeatDays: f.repeatDays,
      repeatInterval: Number(f.repeatInterval) || 1, startDate: f.startDate || undefined, endDate: f.endDate || null,
      goalId: f.goalId ? Number(f.goalId) : null, isHabit: f.isHabit,
    };
    try {
      if (task) await patch(`/tasks/${task.id}`, body); else await post('/tasks', body);
      toast('success', task ? 'Task updated' : 'Task added');
      bump();
      onSaved?.();
      onClose();
    } catch (e) {
      const d = e instanceof ApiError ? e.details as { fieldErrors?: Record<string, string[]> } | undefined : undefined;
      setErr(d?.fieldErrors ? Object.entries(d.fieldErrors).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') : e instanceof Error ? e.message : 'Couldn’t save');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit task' : f.isHabit ? 'New habit' : 'New task'} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Task name" className="sm:col-span-2"><input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={200} placeholder="e.g. Practice coding for 60 minutes" /></Field>
        <Field label="Description (optional)" className="sm:col-span-2"><textarea className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{(settings?.categories ?? []).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
        <Field label="Scheduled time"><input type="time" className="input" value={f.scheduledTime} onChange={(e) => set('scheduledTime', e.target.value)} /></Field>
        <Field label="Reminder" hint={!f.scheduledTime && f.reminderMinutes !== '' ? 'Pick a scheduled time for the reminder.' : undefined}>
          <select className="input" value={f.reminderMinutes} onChange={(e) => set('reminderMinutes', e.target.value)}>{REMINDERS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
        </Field>
        <Field label="Estimated duration (minutes)"><input type="number" min={1} max={1440} className="input" value={f.durationMin} onChange={(e) => set('durationMin', e.target.value)} /></Field>
        <Field label="Linked goal"><select className="input" value={f.goalId} onChange={(e) => set('goalId', e.target.value)}><option value="">None</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></Field>
        <Field label="Repeat"><select className="input" value={f.repeatType} onChange={(e) => set('repeatType', e.target.value as Task['repeatType'])}>
          <option value="none">Just once</option><option value="daily">Every day</option><option value="selected_days">Selected days</option><option value="weekly">Weekly</option><option value="custom">Custom interval</option></select></Field>
        {f.repeatType === 'custom' && <Field label="Every how many days?"><input type="number" min={1} max={365} className="input" value={f.repeatInterval} onChange={(e) => set('repeatInterval', Number(e.target.value))} /></Field>}
        {f.repeatType === 'selected_days' && (
          <div className="sm:col-span-2"><span className="label">Days</span>
            <div className="flex flex-wrap gap-2">{DAY_NAMES.map((n, i) => <button type="button" key={n} aria-pressed={f.repeatDays.includes(i)} className={`btn btn-sm ${f.repeatDays.includes(i) ? 'btn-primary' : ''}`} onClick={() => toggleDay(i)}>{n}</button>)}</div>
          </div>
        )}
        <Field label={f.repeatType === 'none' ? 'Date' : 'Starts on'}><input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        {f.repeatType !== 'none' && <Field label="Ends on (optional)"><input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>}
        <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isHabit} onChange={(e) => set('isHabit', e.target.checked)} /> Track this as a habit (streaks and consistency)</label>
        {err && <div role="alert" className="sm:col-span-2 text-sm p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' }}>{err}</div>}
        <button className="sr-only">Save</button>
      </form>
    </Modal>
  );
}

/** Delete flow with the two choices the API supports. */
export function DeleteTask({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { toast, bump } = useApp();
  const run = async (keepHistory: boolean) => {
    if (!task) return;
    try {
      await del(`/tasks/${task.id}${keepHistory ? '?keepHistory=true' : ''}`);
      toast('success', keepHistory ? 'Task ended. Your history is kept.' : 'Task deleted');
      bump();
    } catch (e) { toast('error', 'Couldn’t delete', e instanceof Error ? e.message : undefined); }
    onClose();
  };
  const recurring = !!task && task.repeatType !== 'none';
  return (
    <Confirm open={!!task} danger title={`Delete “${task?.title ?? ''}”?`} confirmLabel="Delete everything" onCancel={onClose} onConfirm={() => run(false)}
      extra={recurring ? <button className="btn" onClick={() => run(true)}>Stop repeating, keep history</button> : undefined}
      body={recurring ? 'This task repeats. You can stop it from appearing in future and keep your past completion records, or delete it along with all its history.' : 'This removes the task and its completion record. This can’t be undone.'} />
  );
}
