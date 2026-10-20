import { Bell, Download, LogOut, Moon, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Confirm, Field, Modal, PageHeader, Toggle } from '../components/ui';
import { del, download, get, patch, post } from '../lib/api';
import { askNotificationPermission, notifSupported } from '../lib/fx';
import { listVoices, ttsSupported } from '../lib/voice';
import { useApp } from '../store';

const Section = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => (
  <section className="glass p-5" aria-label={title}><h2 className="font-semibold">{title}</h2>{hint && <p className="text-xs muted mt-0.5">{hint}</p>}<div className="mt-3">{children}</div></section>
);

/** Number input that saves when you leave the field. */
function Num({ label, value, min, max, onSave, suffix }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Math.min(max, Math.max(min, Math.round(Number(v) || value))); setV(String(n)); if (n !== value) onSave(n); };
  return <Field label={label}><div className="flex items-center gap-2"><input type="number" className="input" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />{suffix && <span className="text-sm muted">{suffix}</span>}</div></Field>;
}

export default function Settings() {
  const { me, settings, saveSettings, refreshMe, logout, toast, bump, say } = useApp();
  const s = settings!;
  const [name, setName] = useState(me!.name);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [notif, setNotif] = useState<string>(notifSupported() ? Notification.permission : 'unsupported');
  const [newCat, setNewCat] = useState('');
  const [table, setTable] = useState('logs');
  const [ai, setAi] = useState<{ mode: string; note: string } | null>(null);
  const [demo, setDemo] = useState<{ active: boolean; loaded: boolean } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delText, setDelText] = useState('');
  const [pw, setPw] = useState({ cur: '', next: '' });

  useEffect(() => {
    setVoices(listVoices());
    if (ttsSupported()) window.speechSynthesis.onvoiceschanged = () => setVoices(listVoices());
    get('/coach/status').then(setAi).catch(() => {});
    get('/demo').then(setDemo).catch(() => {});
  }, []);

  const fail = (t: string) => (e: unknown) => toast('error', t, e instanceof Error ? e.message : undefined);
  const save = (p: Record<string, unknown>) => saveSettings(p).then((r) => r && bump());

  const reqNotif = async () => { setNotif(await askNotificationPermission()); };
  const addCat = () => { const c = newCat.trim(); if (!c || s.categories.includes(c)) return; save({ categories: [...s.categories, c] }); setNewCat(''); };

  const demoAction = async (path: string, method: 'POST' | 'DELETE', msg: string) => {
    try { await (method === 'POST' ? post(path) : del(path)); await refreshMe(); setDemo(await get('/demo')); bump(); toast('success', msg); } catch (e) { fail('Couldn’t change preview mode')(e); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Settings" sub="Make LEVEL UP work the way you do." />

      <Section title="Profile">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name"><div className="flex gap-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /><button className="btn" disabled={!name.trim() || name === me!.name} onClick={() => patch('/me', { name: name.trim() }).then(() => { void refreshMe(); toast('success', 'Name updated'); }).catch(fail('Couldn’t save'))}>Save</button></div></Field>
          <Field label="Email"><input className="input" value={me!.email} disabled /></Field>
        </div>
        <p className="text-xs muted mt-2">Avatars and themes unlock as you level up. Pick them on the Achievements page.</p>
      </Section>

      <Section title="Appearance and feedback">
        <div className="flex gap-2 mb-2" role="group" aria-label="Theme">
          <button className={`btn ${s.theme === 'dark' ? 'btn-primary' : ''}`} aria-pressed={s.theme === 'dark'} onClick={() => save({ theme: 'dark' })}><Moon size={16} />Dark</button>
          <button className={`btn ${s.theme === 'light' ? 'btn-primary' : ''}`} aria-pressed={s.theme === 'light'} onClick={() => save({ theme: 'light' })}><Sun size={16} />Light</button>
        </div>
        <Toggle label="Animations and confetti" hint="Turn off for a calmer, faster interface." checked={s.animations} onChange={(v) => save({ animations: v })} />
        <Toggle label="Completion sounds" hint="A soft chime when you finish tasks." checked={s.sounds} onChange={(v) => save({ sounds: v })} />
      </Section>

      <Section title="Voice assistant" hint="Off until you turn it on. Voice input only listens when you press the mic button, and your browser asks permission first.">
        {!ttsSupported() ? <p className="text-sm muted">Spoken replies aren’t supported in this browser. Everything still works in text.</p> : <>
          <Toggle label="Speak messages aloud" checked={s.voice.enabled} onChange={(v) => save({ voice: { enabled: v } })} />
          <Toggle label="Mute" hint="Keeps voice settings but stays silent." checked={s.voice.muted} onChange={(v) => save({ voice: { muted: v } })} />
          <div className="grid sm:grid-cols-3 gap-4 mt-2">
            <Field label="Voice"><select className="input" value={s.voice.voiceName ?? ''} onChange={(e) => save({ voice: { voiceName: e.target.value || null } })}><option value="">Default</option>{voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select></Field>
            <Field label={`Speed (${s.voice.rate.toFixed(1)}x)`}><input type="range" min={0.5} max={2} step={0.1} className="w-full" value={s.voice.rate} onChange={(e) => save({ voice: { rate: Number(e.target.value) } })} /></Field>
            <Field label={`Volume (${Math.round(s.voice.volume * 100)}%)`}><input type="range" min={0} max={1} step={0.1} className="w-full" value={s.voice.volume} onChange={(e) => save({ voice: { volume: Number(e.target.value) } })} /></Field>
          </div>
          <button className="btn btn-sm mt-3" onClick={() => say('Good morning! Let’s plan a great day.', true)}>Test voice</button>
        </>}
      </Section>

      <Section title="Targets and schedule">
        <div className="grid sm:grid-cols-2 gap-4">
          <Num label="A day counts for your streak when you finish at least" value={s.dailyTargetPercent} min={1} max={100} suffix="% of planned tasks" onSave={(n) => save({ dailyTargetPercent: n })} />
          <Num label="Weekly target" value={s.weeklyTargetTasks} min={1} max={500} suffix="tasks" onSave={(n) => save({ weeklyTargetTasks: n })} />
          <Field label="Preferred working hours"><div className="flex items-center gap-2"><input type="time" className="input" value={s.workingHours.start} onChange={(e) => save({ workingHours: { start: e.target.value } })} /><span className="muted">to</span><input type="time" className="input" value={s.workingHours.end} onChange={(e) => save({ workingHours: { end: e.target.value } })} /></div></Field>
          <Field label="Week starts on"><select className="input" value={s.weekStart} onChange={(e) => save({ weekStart: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
          <Field label="Time zone" hint="Decides when “today” starts."><input className="input" value={s.timezone} onChange={(e) => save({ timezone: e.target.value })} list="tz" /><datalist id="tz">{(Intl as any).supportedValuesOf?.('timeZone').map((z: string) => <option key={z} value={z} />)}</datalist></Field>
        </div>
        <p className="text-xs muted mt-3">Rest matters. Days where everything left was skipped on purpose count as rest days and never break a streak.</p>
      </Section>

      <Section title="Categories" hint="Used by tasks and goals. Removing one doesn’t change existing records.">
        <div className="flex flex-wrap gap-2">{s.categories.map((c) => <span key={c} className="chip !text-sm !py-1">{c}<button aria-label={`Remove ${c}`} className="ml-1" onClick={() => s.categories.length > 1 && save({ categories: s.categories.filter((x) => x !== c) })}>✕</button></span>)}</div>
        <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); addCat(); }}><input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={30} aria-label="New category" /><button className="btn" disabled={!newCat.trim()}>Add</button></form>
      </Section>

      <Section title="Reminders" hint="Reminders appear while LEVEL UP is open in your browser. If you close the tab or the browser, they can’t fire, because there’s no background notification service.">
        <Toggle label="Morning planning and evening reflection reminders" checked={s.reminders.enabled} onChange={(v) => save({ reminders: { enabled: v } })} />
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Morning planning"><input type="time" className="input" value={s.reminders.morningPlanning} onChange={(e) => save({ reminders: { morningPlanning: e.target.value } })} /></Field>
          <Field label="Evening reflection"><input type="time" className="input" value={s.reminders.eveningReflection} onChange={(e) => save({ reminders: { eveningReflection: e.target.value } })} /></Field>
          <Num label="Goal deadline warning" value={s.reminders.goalDeadlineDaysBefore} min={0} max={30} suffix="days before" onSave={(n) => save({ reminders: { goalDeadlineDaysBefore: n } })} />
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button className="btn" onClick={reqNotif} disabled={notif === 'granted' || notif === 'unsupported'}><Bell size={16} />{notif === 'granted' ? 'Browser notifications are on' : 'Allow browser notifications'}</button>
          <span className="text-xs muted">{notif === 'denied' ? 'Blocked in your browser settings. In-app reminders still appear on screen.' : notif === 'unsupported' ? 'Not supported here. Reminders show inside the app.' : 'Your browser will ask for permission.'}</span>
        </div>
      </Section>

      <Section title="Privacy and AI coach">
        <Toggle label="Allow the AI coach to use my progress" hint="Only totals and task titles are shared, never journal text. It only matters if the server has an AI key." checked={s.privacy.allowAiCoach} onChange={(v) => save({ privacy: { allowAiCoach: v } })} />
        {ai && <p className="text-sm muted mt-1">{ai.mode === 'ai' ? '✨ AI coaching is active.' : 'AI coaching isn’t set up, so the built-in coach is used. Everything works without it.'}</p>}
      </Section>

      <Section title="Sample data" hint="Preview the app with made-up data. Your real records are kept completely separate.">
        <div className="flex flex-wrap gap-2 items-center">
          {demo?.active ? <button className="btn btn-primary" onClick={() => demoAction('/demo/exit', 'POST', 'Back to your own data')}>Exit preview mode</button> : <button className="btn" onClick={() => demoAction('/demo/load', 'POST', 'Preview mode is on. This is sample data.')}>Load sample data</button>}
          {demo?.loaded && <button className="btn btn-danger" onClick={() => demoAction('/demo', 'DELETE', 'Sample data removed')}>Remove sample data</button>}
        </div>
      </Section>

      <Section title="Your data" hint="Export what’s shown now. Sample data is exported only while preview mode is on.">
        <div className="flex flex-wrap gap-2 items-center">
          <button className="btn" onClick={() => download('/export/json', 'level-up-export.json').catch(fail('Download failed'))}><Download size={16} />Export everything (JSON)</button>
          <select className="input !w-auto" value={table} onChange={(e) => setTable(e.target.value)} aria-label="CSV table">{['logs', 'tasks', 'goals', 'milestones', 'journal', 'focus', 'xp', 'achievements'].map((t) => <option key={t}>{t}</option>)}</select>
          <button className="btn" onClick={() => download(`/export/csv?table=${table}`, `level-up-${table}.csv`).catch(fail('Download failed'))}><Download size={16} />Export CSV</button>
        </div>
        <details className="mt-4"><summary className="text-sm cursor-pointer muted">Change password</summary>
          <form className="grid sm:grid-cols-3 gap-3 mt-3 items-end" onSubmit={(e) => { e.preventDefault(); post('/me/password', { currentPassword: pw.cur, newPassword: pw.next }).then(() => { setPw({ cur: '', next: '' }); toast('success', 'Password changed'); }).catch(fail('Couldn’t change password')); }}>
            <Field label="Current password"><input type="password" className="input" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} autoComplete="current-password" /></Field>
            <Field label="New password"><input type="password" className="input" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
            <button className="btn" disabled={!pw.cur || pw.next.length < 8}>Update</button>
          </form>
        </details>
        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t" style={{ borderColor: 'var(--card-border)' }}>
          <button className="btn" onClick={logout}><LogOut size={16} />Sign out</button>
          <button className="btn btn-danger" onClick={() => setResetOpen(true)}><Trash2 size={16} />Reset my data</button>
          <button className="btn btn-danger" onClick={() => setDelOpen(true)}>Delete account</button>
        </div>
      </Section>

      <Confirm open={resetOpen} danger title="Reset all your data?" confirmLabel="Reset my data" onCancel={() => { setResetOpen(false); setResetText(''); }}
        onConfirm={() => { if (resetText !== 'RESET MY DATA') { toast('info', 'Type RESET MY DATA exactly to confirm.'); return; } post('/data/reset', { confirm: 'RESET MY DATA' }).then(() => { toast('success', 'Your data was reset'); setResetOpen(false); setResetText(''); bump(); }).catch(fail('Couldn’t reset')); }}
        body={<div className="space-y-2"><p>This deletes every task, goal, journal entry, focus session, XP and badge. Your account and settings stay. It can’t be undone. Consider exporting first.</p><input className="input" value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="Type RESET MY DATA" aria-label="Confirmation text" /></div>} />
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete your account" footer={<><button className="btn" onClick={() => setDelOpen(false)}>Cancel</button><button className="btn btn-danger" disabled={!delPw || delText !== 'DELETE MY ACCOUNT'} onClick={() => del('/me', { password: delPw, confirm: 'DELETE MY ACCOUNT' }).then(() => logout()).catch(fail('Couldn’t delete account'))}>Delete forever</button></>}>
        <div className="space-y-3 text-sm"><p className="muted">This permanently removes your account and everything in it.</p>
          <Field label="Your password"><input type="password" className="input" value={delPw} onChange={(e) => setDelPw(e.target.value)} /></Field>
          <Field label="Type DELETE MY ACCOUNT to confirm"><input className="input" value={delText} onChange={(e) => setDelText(e.target.value)} /></Field></div>
      </Modal>
    </div>
  );
}
