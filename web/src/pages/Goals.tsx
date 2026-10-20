import { CalendarDays, Plus, Target, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHeader, PriorityChip, ProgressBar, catIcon } from '../components/ui';
import { ApiError, del, get, patch, post, type Goal } from '../lib/api';
import { fmtShort } from '../lib/dates';
import { useApp, useLoad } from '../store';

const STATUS_LABEL: Record<Goal['status'], string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', paused: 'Paused' };

function GoalForm({ open, goal, onClose }: { open: boolean; goal: Goal | null; onClose: () => void }) {
  const { settings, me, toast, bump } = useApp();
  const empty = { title: '', description: '', category: 'Personal', startDate: me?.today ?? '', targetDate: '', priority: 'medium', targetValue: '', unit: '', currentValue: '0', status: 'not_started', milestones: [] as string[] };
  const [f, setF] = useState(empty);
  const [ms, setMs] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(''); setMs('');
    setF(goal ? { title: goal.title, description: goal.description, category: goal.category, startDate: goal.startDate ?? '', targetDate: goal.targetDate ?? '', priority: goal.priority, targetValue: goal.targetValue ? String(goal.targetValue) : '', unit: goal.unit, currentValue: String(goal.currentValue), status: goal.status, milestones: [] } : { ...empty, category: settings?.categories[0] ?? 'Personal' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.title.trim()) { setErr('Give your goal a title.'); return; }
    setBusy(true); setErr('');
    const body: Record<string, unknown> = {
      title: f.title.trim(), description: f.description, category: f.category, startDate: f.startDate || null, targetDate: f.targetDate || null,
      priority: f.priority, targetValue: f.targetValue ? Number(f.targetValue) : null, unit: f.unit, currentValue: Number(f.currentValue) || 0,
    };
    try {
      if (goal) { body.status = f.status; await patch(`/goals/${goal.id}`, body); }
      else await post('/goals', { ...body, status: f.status, milestones: f.milestones.map((title) => ({ title })) });
      toast('success', goal ? 'Goal updated' : 'Goal created');
      bump(); onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Couldn’t save'); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={goal ? 'Edit goal' : 'New goal'} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save goal'}</button></>}>
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Goal title" className="sm:col-span-2"><input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Complete a coding course" /></Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{(settings?.categories ?? []).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
        <Field label="Start date"><input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Target date"><input type="date" className="input" value={f.targetDate} onChange={(e) => set('targetDate', e.target.value)} /></Field>
        <Field label="Measurable target (optional)" hint="For example 40 lessons, 300 pages, 20 workouts."><div className="flex gap-2"><input type="number" min={0} className="input" value={f.targetValue} onChange={(e) => set('targetValue', e.target.value)} placeholder="40" /><input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="lessons" /></div></Field>
        <Field label="Progress so far"><input type="number" min={0} className="input" value={f.currentValue} onChange={(e) => set('currentValue', e.target.value)} /></Field>
        <Field label="Status" className="sm:col-span-2"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {!goal && (
          <div className="sm:col-span-2"><span className="label">Break it into milestones</span>
            <div className="flex gap-2"><input className="input" value={ms} onChange={(e) => setMs(e.target.value)} placeholder="e.g. Finish module 1" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ms.trim()) { setF((x) => ({ ...x, milestones: [...x.milestones, ms.trim()] })); setMs(''); } } }} />
              <button type="button" className="btn" onClick={() => { if (ms.trim()) { setF((x) => ({ ...x, milestones: [...x.milestones, ms.trim()] })); setMs(''); } }}>Add</button></div>
            <ul className="mt-2 space-y-1">{f.milestones.map((m, i) => <li key={i} className="flex justify-between text-sm px-3 py-1.5 rounded-lg" style={{ background: 'var(--faint)' }}>{m}<button type="button" onClick={() => setF((x) => ({ ...x, milestones: x.milestones.filter((_, j) => j !== i) }))} aria-label={`Remove ${m}`}>✕</button></li>)}</ul>
          </div>
        )}
        {err && <div role="alert" className="sm:col-span-2 text-sm p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' }}>{err}</div>}
        <button className="sr-only">Save</button>
      </form>
    </Modal>
  );
}

function GoalDetail({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (g: Goal) => void }) {
  const { celebrate, toast, bump } = useApp();
  const { data: g, reload } = useLoad(() => (id ? get<Goal>(`/goals/${id}`) : Promise.resolve(null)), [id]);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (g) setValue(String(g.currentValue)); }, [g]);

  if (!id) return null;
  const run = async (fn: () => Promise<any>) => { try { const r = await fn(); if (r) celebrate(r); bump(); reload(); } catch (e) { toast('error', 'Couldn’t update', e instanceof Error ? e.message : undefined); } };

  return (
    <Modal open onClose={onClose} title={g?.title ?? 'Goal'} wide>
      {!g ? <Loading rows={2} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 items-center text-sm muted">
            <span>{catIcon(g.category)} {g.category}</span><PriorityChip p={g.priority} />
            {g.targetDate && <span className="inline-flex items-center gap-1"><CalendarDays size={14} />{fmtShort(g.targetDate)}{g.daysLeft !== null && g.status !== 'completed' && ` · ${g.daysLeft >= 0 ? `${g.daysLeft} days left` : `${-g.daysLeft} days past`}`}</span>}
          </div>
          {g.description && <p className="text-sm">{g.description}</p>}
          <div><div className="flex justify-between text-sm mb-1"><span className="font-semibold">Progress</span><span>{g.progressPercent === null ? 'Add milestones or a target to track this' : `${g.progressPercent}%`}</span></div><ProgressBar value={g.progressPercent} label="Goal progress" /></div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Status"><select className="input" value={g.status} onChange={(e) => run(() => patch(`/goals/${g.id}`, { status: e.target.value }))}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {g.targetValue && (
              <Field label={`Progress (${g.unit || 'units'}) of ${g.targetValue}`}><div className="flex gap-2"><input type="number" className="input" min={0} value={value} onChange={(e) => setValue(e.target.value)} /><button className="btn" onClick={() => run(() => patch(`/goals/${g.id}`, { currentValue: Number(value) || 0 }))}>Update</button></div></Field>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2">Milestones</h3>
            {g.milestones.length === 0 && <p className="text-sm muted mb-2">Break this into smaller steps. Each one you finish earns XP.</p>}
            <ul className="space-y-1.5">{g.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--faint)' }}>
                <input type="checkbox" className="w-5 h-5" checked={m.done} aria-label={m.title} onChange={(e) => run(() => patch(`/goals/${g.id}/milestones/${m.id}`, { done: e.target.checked }))} />
                <span className={`flex-1 text-sm ${m.done ? 'line-through muted' : ''}`}>{m.title}</span>
                <button className="muted" aria-label={`Delete ${m.title}`} onClick={() => run(() => del(`/goals/${g.id}/milestones/${m.id}`))}><Trash2 size={14} /></button>
              </li>))}</ul>
            <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) run(() => post(`/goals/${g.id}/milestones`, { title: title.trim() })).then(() => setTitle('')); }}>
              <input className="input" placeholder="Add a milestone" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New milestone" /><button className="btn" disabled={!title.trim()}>Add</button>
            </form>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Daily habits and tasks linked to this goal</h3>
            {g.linkedTasks?.length ? <ul className="space-y-1.5">{g.linkedTasks.map((t) => <li key={t.id} className="flex justify-between text-sm px-3 py-2 rounded-xl" style={{ background: 'var(--faint)' }}><span>{t.title}</span><span className="muted">{t.last30Days.completionPercent === null ? 'No data yet' : `${t.last30Days.completionPercent}% in 30 days`}</span></li>)}</ul>
              : <p className="text-sm muted">Nothing linked yet. When you add a task, choose this goal under “Linked goal”.</p>}
          </div>

          <div className="flex gap-2 pt-2"><button className="btn" onClick={() => onEdit(g)}>Edit details</button><button className="btn btn-danger" onClick={() => setConfirmDel(true)}>Delete goal</button></div>
          <Confirm open={confirmDel} danger title="Delete this goal?" confirmLabel="Delete goal" onCancel={() => setConfirmDel(false)}
            onConfirm={() => run(() => del(`/goals/${g.id}`)).then(() => { setConfirmDel(false); onClose(); })} body="The goal and its milestones are removed. Linked tasks stay, but they’ll no longer be tied to this goal." />
        </div>
      )}
    </Modal>
  );
}

export default function Goals() {
  const { data, error, reload } = useLoad(() => get<Goal[]>('/goals'));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [cat, setCat] = useState('');

  const list = (data ?? []).filter((g) => (!status || g.status === status) && (!cat || g.category === cat));
  const cats = [...new Set((data ?? []).map((g) => g.category))];

  return (
    <div>
      <PageHeader title="Goals" sub="Big things, broken into steps you can actually take." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} />New goal</button>} />
      {data && data.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="input !w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
      )}
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading /> : data.length === 0 ? (
        <Empty emoji="🎯" title="Set your first goal" body="Try something like “Practice programming 60 minutes daily” or “Finish my college project”. Then split it into milestones." action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Create a goal</button>} />
      ) : list.length === 0 ? <Empty emoji="🔍" title="No goals match these filters" /> : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {list.map((g) => (
            <button key={g.id} className="glass glass-hover p-5 text-left" onClick={() => setOpen(g.id)} aria-label={`Open goal ${g.title}`}>
              <div className="flex justify-between items-start gap-2"><Target size={20} style={{ color: 'var(--a1)' }} /><span className="chip">{STATUS_LABEL[g.status]}</span></div>
              <h3 className="font-semibold text-lg mt-2 leading-snug">{g.title}</h3>
              <div className="flex flex-wrap gap-2 text-xs muted mt-1">
                <span>{catIcon(g.category)} {g.category}</span>
                {g.targetDate && <span style={g.overdue ? { color: 'var(--bad)' } : undefined}>Due {fmtShort(g.targetDate)}</span>}
              </div>
              <div className="mt-4"><div className="flex justify-between text-xs mb-1"><span className="muted">{g.milestones.length ? `${g.milestones.filter((m) => m.done).length}/${g.milestones.length} milestones` : g.targetValue ? `${g.currentValue}/${g.targetValue} ${g.unit}` : 'No milestones yet'}</span><span className="font-semibold">{g.progressPercent === null ? '–' : `${g.progressPercent}%`}</span></div><ProgressBar value={g.progressPercent} label={`${g.title} progress`} /></div>
            </button>
          ))}
        </div>
      )}
      <GoalForm open={adding || !!editing} goal={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      <GoalDetail id={open} onClose={() => setOpen(null)} onEdit={(g) => { setOpen(null); setEditing(g); }} />
    </div>
  );
}
