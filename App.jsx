import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, configured } from './supabase';
import { makeT } from './i18n';
import { useData } from './useData';
import Login from './components/Login.jsx';
import Slots from './components/Slots.jsx';
import Setup from './components/Setup.jsx';

function readLang() {
  try { return localStorage.getItem('lang') === 'en' ? 'en' : 'id'; } catch { return 'id'; }
}

export default function App() {
  const [lang, setLangState] = useState(readLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('lang', l); } catch { /* ignore */ } };

  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(undefined);
  const [tab, setTab] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  useEffect(() => {
    if (!configured) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s || null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id || null;
  useEffect(() => {
    if (!userId) { setProfile(undefined); setTab(null); return undefined; }
    let live = true;
    supabase.from('tradein_profiles').select('*').eq('id', userId).maybeSingle().then(({ data }) => {
      if (live) setProfile(data || { id: userId, role: 'pending', username: '', full_name: '' });
    });
    return () => { live = false; };
  }, [userId]);

  const role = profile?.role;
  const data = useData(userId ? role : null);

  // The admin lands on Setup while there is no city yet.
  useEffect(() => {
    if (tab === null && data.ready) setTab(role === 'admin' && data.cities.length === 0 ? 'setup' : 'slots');
  }, [tab, data.ready, data.cities.length, role]);

  const langSwitch = (
    <div className="lang" role="group" aria-label="Language">
      <button type="button" aria-pressed={lang === 'id'} onClick={() => setLang('id')}>ID</button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
    </div>
  );

  let body;
  let live = null;
  if (!configured) {
    body = <section className="panel"><h2>{t('config.title')}</h2><p className="hint">{t('config.body')}</p></section>;
  } else if (session === undefined || (userId && profile === undefined)) {
    body = <section className="panel"><h2>{t('loading')}</h2><p className="hint">{t('loading.body')}</p></section>;
  } else if (!session) {
    body = <Login t={t} />;
  } else if (role === 'pending') {
    body = <section className="panel"><h2>{t('pending.title')}</h2><p className="hint">{t('pending.body')}</p></section>;
  } else {
    live = data.offline
      ? { state: 'off', text: t('offline') }
      : data.stamp
        ? { state: 'on', text: t('live', { time: data.stamp.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'id-ID', { hour: '2-digit', minute: '2-digit' }) }) }
        : null;
    if (!data.ready) {
      body = <section className="panel"><h2>{t('loading')}</h2><p className="hint">{t('loading.body')}</p></section>;
    } else if (role === 'admin' && tab === 'setup') {
      body = <Setup data={data} profile={profile} t={t} notify={notify} />;
    } else {
      body = <Slots data={data} profile={profile} t={t} lang={lang} notify={notify} goSetup={() => setTab('setup')} />;
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">{t('app.eyebrow')}</p>
          <h1>{t('app.title')}</h1>
        </div>
        {live && (
          <div className="live" data-state={live.state}><span className="dot" /><span>{live.text}</span></div>
        )}
      </header>

      <div className="bar-row">
        {session && profile ? (
          <p className="who">
            <strong>{profile.full_name || profile.username}</strong>
            {' · '}{t(`role.${role}`)}
          </p>
        ) : <span />}
        <div className="bar-acts">
          {langSwitch}
          {session && <button type="button" className="btn small" onClick={() => supabase.auth.signOut()}>{t('signout')}</button>}
        </div>
      </div>

      {session && role === 'admin' && (
        <nav className="tabs" aria-label="Views">
          <button type="button" aria-current={tab === 'slots' ? 'page' : undefined} onClick={() => setTab('slots')}>{t('tab.slots')}</button>
          <button type="button" aria-current={tab === 'setup' ? 'page' : undefined} onClick={() => setTab('setup')}>{t('tab.setup')}</button>
        </nav>
      )}

      <main>{body}</main>

      {toast && <div className="toast" data-kind={toast.kind} role="status" aria-live="polite">{toast.msg}</div>}
    </div>
  );
}
