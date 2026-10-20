import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Confirm, Empty, ErrorBox, Field, Loading, MOODS, PageHeader } from '../components/ui';
import { del, get, put } from '../lib/api';
import { fmtLong, fmtShort } from '../lib/dates';
import { useApp, useLoad } from '../store';

interface Entry { date: string; wentWell: string; learned: string; difficult: string; distracted: string; proud: string; improve: string; notes: string; mood: number | null; energy: number | null }
interface Insight { daysWithMood: number; enoughData: boolean; note: string; byMood: { mood: number; label: string; days: number; avgTasksCompleted: number | null }[] }

const FIELDS: { k: keyof Entry; q: string }[] = [
  { k: 'wentWell', q: 'What went well today?' },
  { k: 'learned', q: 'What did I learn?' },
  { k: 'difficult', q: 'What was difficult?' },
  { k: 'distracted', q: 'What distracted me?' },
  { k: 'proud', q: 'What am I proud of today?' },
  { k: 'improve', q: 'What is one thing I want to improve tomorrow?' },
];
const blank = (): Entry => ({ date: '', wentWell: '', learned: '', difficult: '', distracted: '', proud: '', improve: '', notes: '', mood: null, energy: null });

export default function Journal() {
  const { me, celebrate, toast, bump } = useApp();
  const [date, setDate] = useState(me!.today);
  const [form, setForm] = useState<Entry>(blank());
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const list = useLoad(() => get<Entry[]>('/journal'));
  const insights = useLoad(() => get<Insight>('/journal/insights/mood'));
  const isFuture = date > me!.today;

  useEffect(() => {
    let alive = true;
    setSaved(false);
    // The list endpoint returns [] for an empty day, so a new day isn't a "not found" error.
    get<Entry[]>(`/journal?from=${date}&to=${date}`).then((r) => { if (!alive) return; if (r[0]) { setForm(r[0]); setSaved(true); } else setForm(blank()); }).catch(() => { if (alive) setForm(blank()); });
    return () => { alive = false; };
  }, [date]);

  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const { date: _d, ...body } = form;
      const r = await put(`/journal/${date}`, body);
      celebrate({ rewards: r.rewards });
      toast('success', 'Reflection saved');
      setSaved(true); bump();
    } catch (e) { toast('error', 'Couldn’t save', e instanceof Error ? e.message : undefined); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await del(`/journal/${date}`); setForm(blank()); setSaved(false); toast('success', 'Entry deleted'); bump(); } catch (e) { toast('error', 'Couldn’t delete', e instanceof Error ? e.message : undefined); }
    setConfirmDel(false);
  };

  return (
    <div>
      <PageHeader title="Journal" sub="A few honest lines a day. Reflection earns XP too." actions={<input type="date" className="input !w-auto" value={date} max={me!.today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a day" />} />
      <div className="grid lg:grid-cols-5 gap-6">
        <section className="glass p-5 lg:col-span-3 space-y-4" aria-label="Reflection">
          <div className="flex justify-between items-center"><h2 className="font-semibold">{fmtLong(date)}</h2>{saved && <span className="chip" style={{ color: 'var(--good)' }}>Saved</span>}</div>
          <div>
            <span className="label">Mood</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Mood">{MOODS.map((m) => <button key={m.v} role="radio" aria-checked={form.mood === m.v} title={m.label} aria-label={m.label} onClick={() => set('mood', form.mood === m.v ? null : m.v)} className={`btn !text-2xl !p-2 ${form.mood === m.v ? 'btn-primary' : ''}`}>{m.emoji}</button>)}</div>
          </div>
          <div>
            <span className="label">Energy</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Energy">{[1, 2, 3, 4, 5].map((v) => <button key={v} role="radio" aria-checked={form.energy === v} aria-label={`Energy ${v} of 5`} onClick={() => set('energy', form.energy === v ? null : v)} className={`btn btn-sm ${form.energy === v ? 'btn-primary' : ''}`}>{'⚡'.repeat(Math.min(v, 3))}{v > 3 ? '+' : ''} {v}</button>)}</div>
          </div>
          {FIELDS.map(({ k, q }) => <Field key={k} label={q}><textarea className="input" value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} disabled={isFuture} /></Field>)}
          <Field label="Anything else?"><textarea className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <div className="flex gap-2"><button className="btn btn-primary" onClick={save} disabled={busy || isFuture}>{busy ? 'Saving…' : saved ? 'Update reflection' : 'Save reflection'}</button>{saved && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}><Trash2 size={14} />Delete</button>}</div>
        </section>

        <div className="lg:col-span-2 space-y-6">
          <section className="glass p-5" aria-label="Mood and productivity">
            <h2 className="font-semibold mb-1">Mood and productivity</h2>
            {!insights.data ? <Loading rows={1} /> : (
              <>
                <p className="text-sm muted mb-3">{insights.data.note}</p>
                {insights.data.enoughData && <ul className="space-y-1.5">{insights.data.byMood.filter((m) => m.days > 0).map((m) => <li key={m.mood} className="flex justify-between text-sm px-3 py-2 rounded-xl" style={{ background: 'var(--faint)' }}><span>{MOODS[m.mood - 1].emoji} {m.label} <span className="muted">({m.days} days)</span></span><span>{m.avgTasksCompleted} tasks/day</span></li>)}</ul>}
              </>
            )}
          </section>
          <section aria-label="Past entries"><h2 className="font-semibold mb-2">Past entries</h2>
            {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data ? <Loading rows={2} /> : list.data.length === 0 ? <Empty emoji="📔" title="No entries yet" body="Your first reflection will show up here." /> : (
              <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">{list.data.map((e) => (
                <li key={e.date}><button className="glass glass-hover w-full p-3 text-left" onClick={() => { setDate(e.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  <div className="flex justify-between text-sm font-semibold"><span>{fmtShort(e.date)}</span><span aria-hidden>{e.mood ? MOODS[e.mood - 1].emoji : ''}</span></div>
                  <p className="text-xs muted line-clamp-2 mt-0.5">{e.wentWell || e.proud || e.learned || e.notes || 'No text'}</p>
                </button></li>))}</ul>)}
          </section>
        </div>
      </div>
      <Confirm open={confirmDel} danger title="Delete this entry?" body="This reflection will be removed. Your tasks and stats aren’t affected." confirmLabel="Delete entry" onCancel={() => setConfirmDel(false)} onConfirm={remove} />
    </div>
  );
}
