import { useState } from 'react';
import { post } from '../lib/api';
import { useApp } from '../store';
import { Field } from '../components/ui';

export default function Auth() {
  const { login } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = mode === 'register'
        ? await post('/auth/register', { name, email, password, timezone: tz })
        : await post('/auth/login', { email, password });
      await login(r.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md page-enter">
        <div className="text-center mb-6">
          <div className="text-6xl float" aria-hidden>🚀</div>
          <h1 className="display text-4xl font-bold grad-text mt-2">LEVEL UP</h1>
          <p className="muted mt-1">One day at a time. One level at a time.</p>
        </div>
        <form className="glass p-6 space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl" style={{ background: 'var(--faint)' }} role="tablist">
            {(['register', 'login'] as const).map((m) => (
              <button type="button" key={m} role="tab" aria-selected={mode === m} className={`btn !border-0 ${mode === m ? 'btn-primary' : '!bg-transparent'}`} onClick={() => { setMode(m); setError(''); }}>
                {m === 'register' ? 'Create account' : 'Sign in'}
              </button>
            ))}
          </div>
          {mode === 'register' && <Field label="Your name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" /></Field>}
          <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          </Field>
          {error && <div role="alert" className="text-sm p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' }}>{error}</div>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'One moment…' : mode === 'register' ? 'Start my journey' : 'Sign in'}</button>
          <p className="text-xs muted text-center">Your data is stored on your own server. No paid services needed.</p>
        </form>
      </div>
    </div>
  );
}
