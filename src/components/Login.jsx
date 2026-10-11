import { useState } from 'react';
import { supabase, toEmail } from '../supabase';

export default function Login({ t }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(login), password });
    if (error) setErr(t('login.err'));
    setBusy(false);
  }

  return (
    <section className="panel narrow-panel">
      <h2>{t('login.title')}</h2>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="login-user">{t('login.user')}</label>
          <input id="login-user" type="text" autoComplete="username" autoCapitalize="none" spellCheck="false"
            value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="login-pass">{t('login.pass')}</label>
          <input id="login-pass" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <p className="err" role="alert">{err}</p>
        <div><button className="btn primary" disabled={busy || !login || !password}>{busy ? t('login.wait') : t('login.btn')}</button></div>
      </form>
      <p className="hint">{t('login.hint')}</p>
    </section>
  );
}
