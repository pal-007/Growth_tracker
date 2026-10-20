import { Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { get, post, put } from '../lib/api';
import { listVoices, listen, sttSupported, stopSpeaking, ttsSupported } from '../lib/voice';
import { useApp } from '../store';
import { Modal, Toggle } from './ui';

type Mode = 'ask' | 'task' | 'reflect';
interface Msg { from: 'me' | 'coach'; text: string }

const BRIEFS = [
  { type: 'morning', label: 'Morning plan' },
  { type: 'today', label: 'Today’s progress' },
  { type: 'next', label: 'What next?' },
  { type: 'reminders', label: 'Reminders' },
  { type: 'week', label: 'This week' },
  { type: 'evening', label: 'Evening check-in' },
];

export default function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, me, saveSettings, say, toast, bump, celebrate } = useApp();
  const [mode, setMode] = useState<Mode>('ask');
  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'coach', text: 'Hi! Ask me what to focus on, hear a summary, or add a task by typing or speaking.' }]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<{ mode: string; note: string } | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    get('/coach/status').then(setStatus).catch(() => {});
    setVoices(listVoices());
    if (ttsSupported()) window.speechSynthesis.onvoiceschanged = () => setVoices(listVoices());
  }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { if (!open) { stopRef.current(); stopSpeaking(); } }, [open]);

  if (!settings) return null;
  const v = settings.voice;
  const push = (m: Msg) => setMsgs((x) => [...x, m]);
  const reply = (t: string) => { push({ from: 'coach', text: t }); say(t); };

  const brief = async (type: string, label: string) => {
    setBusy(true);
    push({ from: 'me', text: label });
    try { reply((await get<{ text: string }>(`/coach/briefing?type=${type}`)).text); }
    catch (e) { reply(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const submit = async (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t) return;
    setText('');
    push({ from: 'me', text: t });
    setBusy(true);
    try {
      if (mode === 'ask') {
        const r = await post<{ reply: string; source: string; aiUnavailable?: boolean }>('/coach/ask', { message: t });
        reply(r.reply);
        if (r.aiUnavailable) toast('info', 'AI coach is unavailable right now', 'Used the built-in coach instead.');
      } else if (mode === 'task') {
        const r = await post<{ task: { title: string; scheduledTime: string | null; startDate: string } }>('/tasks/quick', { text: t });
        reply(`Added “${r.task.title}”${r.task.scheduledTime ? ` at ${r.task.scheduledTime}` : ''} for ${r.task.startDate === me?.today ? 'today' : r.task.startDate}.`);
        bump();
      } else {
        const today = me!.today;
        const cur = (await get<{ notes: string }[]>(`/journal?from=${today}&to=${today}`).catch(() => []))[0];
        const r = await put(`/journal/${today}`, { notes: [cur?.notes, t].filter(Boolean).join('\n') });
        celebrate({ rewards: r.rewards });
        reply('Saved to today’s reflection.');
        bump();
      }
    } catch (e) {
      reply(e instanceof Error ? e.message : 'Something went wrong.');
    } finally { setBusy(false); }
  };

  const mic = () => {
    if (listening) { stopRef.current(); return; }
    setListening(true);
    stopRef.current = listen((t) => { setText(t); void submit(t); }, () => setListening(false), (m) => toast('info', m));
  };

  return (
    <Modal open={open} onClose={onClose} title="Voice assistant" wide>
      <div className="grid md:grid-cols-[1fr_16rem] gap-5">
        <div className="flex flex-col min-h-[22rem]">
          <div className="flex flex-wrap gap-2 mb-3">
            {BRIEFS.map((b) => <button key={b.type} className="btn btn-sm" disabled={busy} onClick={() => brief(b.type, b.label)}>{b.label}</button>)}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-72" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : ''}`}>
                <div className={`px-3 py-2 rounded-2xl text-sm max-w-[85%] ${m.from === 'me' ? 'grad-bg text-white' : ''}`} style={m.from === 'coach' ? { background: 'var(--faint)' } : undefined}>{m.text}</div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="flex gap-2 mt-3 text-sm">
            {([['ask', 'Ask'], ['task', 'Add task'], ['reflect', 'Add to reflection']] as [Mode, string][]).map(([k, l]) => (
              <button key={k} className={`btn btn-sm ${mode === k ? 'btn-primary' : ''}`} onClick={() => setMode(k)} aria-pressed={mode === k}>{l}</button>
            ))}
          </div>
          <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message"
              placeholder={mode === 'ask' ? 'What should I focus on next?' : mode === 'task' ? 'read 10 pages at 6pm tomorrow high priority' : 'How is your day going?'} />
            {sttSupported() && (
              <button type="button" className={`btn btn-icon ${listening ? 'btn-primary pulse' : ''}`} onClick={mic} aria-label={listening ? 'Stop listening' : 'Speak'}>{listening ? <MicOff size={18} /> : <Mic size={18} />}</button>
            )}
            <button className="btn btn-primary btn-icon" disabled={busy || !text.trim()} aria-label="Send"><Send size={18} /></button>
          </form>
          {!sttSupported() && <p className="text-xs muted mt-2">Voice input isn’t available in this browser, so typing works instead. The microphone is only used when you press the mic button.</p>}
          {status && <p className="text-xs muted mt-2">{status.mode === 'ai' ? 'Replies come from the AI coach.' : 'Replies come from the built-in coach (no AI key is set up).'}</p>}
        </div>

        <div className="space-y-1 md:border-l md:pl-5" style={{ borderColor: 'var(--card-border)' }}>
          <h3 className="font-semibold text-sm mb-1">Voice settings</h3>
          {!ttsSupported() ? <p className="text-xs muted">Spoken replies aren’t supported in this browser. Text replies still work.</p> : (
            <>
              <Toggle label="Speak replies" hint="Off by default" checked={v.enabled} onChange={(x) => saveSettings({ voice: { enabled: x } })} />
              <button className="btn btn-sm w-full" onClick={() => saveSettings({ voice: { muted: !v.muted } })}>{v.muted ? <><VolumeX size={14} /> Muted</> : <><Volume2 size={14} /> Mute</>}</button>
              <label className="block pt-2"><span className="label">Voice</span>
                <select className="input" value={v.voiceName ?? ''} onChange={(e) => saveSettings({ voice: { voiceName: e.target.value || null } })}>
                  <option value="">Default</option>
                  {voices.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select></label>
              <label className="block pt-2"><span className="label">Speed ({v.rate.toFixed(1)}x)</span>
                <input type="range" min={0.5} max={2} step={0.1} value={v.rate} onChange={(e) => saveSettings({ voice: { rate: Number(e.target.value) } })} className="w-full" /></label>
              <label className="block pt-2"><span className="label">Volume ({Math.round(v.volume * 100)}%)</span>
                <input type="range" min={0} max={1} step={0.1} value={v.volume} onChange={(e) => saveSettings({ voice: { volume: Number(e.target.value) } })} className="w-full" /></label>
              <button className="btn btn-sm w-full mt-2" onClick={() => say('Good morning! Let’s plan a great day.', true)}>Test voice</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
