import { useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { dbMessage, fmtTime } from '../i18n';

function statusOf(city) {
  if (!city.is_open) return 'closed';
  const left = Math.max(0, city.buyer_limit - city.used);
  if (left === 0) return 'full';
  if (left <= Math.max(3, Math.ceil(city.buyer_limit * 0.1)) && left < city.buyer_limit) return 'low';
  return 'open';
}

function CityCard({ city, rows, role, me, people, t, lang, reload, notify }) {
  const [name, setName] = useState('');
  const [kec, setKec] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null);

  const limit = city.buyer_limit;
  const used = city.used;
  const left = Math.max(0, limit - used);
  const st = statusOf(city);
  const wide = role === 'admin' || role === 'manager';
  const canAdd = role === 'admin' || role === 'sales';
  const active = rows.filter((r) => !r.cancelled_at);
  const cancelled = rows.filter((r) => r.cancelled_at);
  const hasList = Array.isArray(city.kecamatan) && city.kecamatan.length > 0;

  const byKec = useMemo(() => {
    const m = new Map();
    active.forEach((r) => m.set(r.kecamatan, (m.get(r.kecamatan) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const kecMax = byKec.length ? byKec[0][1] : 1;

  const who = (id) => (id === me.id ? t('you') : (people[id] && (people[id].full_name || people[id].username)) || t('unknown'));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (name.trim().length < 2) { setErr(t('err.NAME_REQUIRED')); return; }
    if (kec.trim().length < 2) { setErr(t('err.KECAMATAN_REQUIRED')); return; }
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('tradein_add_buyer', { p_city: city.id, p_name: name, p_kecamatan: kec });
    setBusy(false);
    if (error) {
      const msg = dbMessage(t, error);
      if (String(error.message || '').includes('FULL')) notify(msg, 'bad'); else setErr(msg);
      reload();
      return;
    }
    setName('');
    notify(t('ok.added', { n: data && typeof data.remaining === 'number' ? data.remaining : Math.max(0, left - 1) }));
    reload();
  }

  async function cancel(id) {
    setConfirm(null);
    const { error } = await supabase.rpc('tradein_cancel_buyer', { p_id: id });
    if (error) notify(dbMessage(t, error), 'bad'); else notify(t('ok.cancelled'));
    reload();
  }

  const fid = `c-${city.id}`;

  // One tap opens WhatsApp with the current status, ready to send to a chat or group.
  const waKey = st === 'full' ? 'wa.msgFull' : st === 'closed' ? 'wa.msgClosed' : 'wa.msg';
  const waText = t(waKey, { city: city.name, left, limit, time: fmtTime(Date.now(), lang) });
  const waLink = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <section className="city" data-status={st}>
      <div className="city-head">
        <h2>{city.name}</h2>
        <span className="pill">{t(`st.${st}`)}</span>
      </div>

      <div className="count">
        <div className="big"><span className="num">{left}</span><span className="unit">{t('slotsLeft')}</span></div>
        <dl className="mini">
          <div><dt>{t('limit')}</dt><dd>{limit}</dd></div>
          <div><dt>{t('used')}</dt><dd>{used}</dd></div>
        </dl>
      </div>

      {limit <= 200 ? (
        <div className="cells" role="img" aria-label={`${used} / ${limit}`}>
          {Array.from({ length: limit }, (_, i) => <i key={i} className={i < used ? 't' : undefined} />)}
        </div>
      ) : (
        <div className="bar" role="img" aria-label={`${used} / ${limit}`}>
          <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
        </div>
      )}

      <div><a className="btn small link-btn" href={waLink} target="_blank" rel="noopener noreferrer">{t('wa.share')}</a></div>

      {st === 'full' && <p className="notice full">{t('full.notice')}</p>}
      {st === 'closed' && <p className="notice">{t('closed.notice')}</p>}

      {canAdd && st !== 'full' && st !== 'closed' && (
        <form onSubmit={submit} noValidate>
          <div className="row">
            <div className="field">
              <label htmlFor={`${fid}-name`}>{t('f.name')}</label>
              <input id={`${fid}-name`} type="text" maxLength={80} autoComplete="off" autoCapitalize="words"
                placeholder={t('f.name.ph')} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${fid}-kec`}>{t('f.kec')}</label>
              {hasList ? (
                <select id={`${fid}-kec`} value={kec} onChange={(e) => setKec(e.target.value)}>
                  <option value="">{t('f.kec.pick')}</option>
                  {city.kecamatan.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              ) : (
                <input id={`${fid}-kec`} type="text" maxLength={60} autoComplete="off" autoCapitalize="words"
                  placeholder={t('f.kec.ph')} value={kec} onChange={(e) => setKec(e.target.value)} />
              )}
            </div>
          </div>
          <p className="err" role="alert">{err}</p>
          <div><button className="btn primary" disabled={busy}>{busy ? t('f.saving') : t('f.add')}</button></div>
        </form>
      )}

      {wide && byKec.length > 0 && (
        <div className="kec">
          <h3>{t('byKec')}</h3>
          <ul>
            {byKec.map(([k, n]) => (
              <li key={k}>
                <span className="kec-name">{k}</span>
                <span className="kec-bar"><span style={{ width: `${(n / kecMax) * 100}%` }} /></span>
                <span className="kec-n">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="log" open>
        <summary>{t(wide ? 'list.all' : 'list.mine')} <span className="n">{active.length}</span></summary>
        {active.length === 0 ? <p className="none">{t('list.none')}</p> : (
          <ol className="rows">
            {active.map((r) => {
              const mayCancel = role === 'admin' || role === 'manager' || r.created_by === me.id;
              return (
                <li key={r.id}>
                  <span className="what">
                    <span className="ref">{r.buyer_name}</span>
                    <span className="meta">
                      {r.kecamatan} · {fmtTime(r.created_at, lang)}
                      {wide && <> · {t('list.by', { name: who(r.created_by) })}</>}
                    </span>
                  </span>
                  <span className="acts">
                    {mayCancel && (confirm === r.id ? (
                      <>
                        <button type="button" className="btn small danger" onClick={() => cancel(r.id)}>{t('cancel.yes')}</button>
                        <button type="button" className="btn small" onClick={() => setConfirm(null)}>{t('cancel.no')}</button>
                      </>
                    ) : (
                      <button type="button" className="btn small" onClick={() => setConfirm(r.id)}>{t('cancel')}</button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </details>

      {wide && cancelled.length > 0 && (
        <details className="log">
          <summary>{t('list.cancelled')} <span className="n">{cancelled.length}</span></summary>
          <ol className="rows">
            {cancelled.map((r) => (
              <li key={r.id}>
                <span className="what">
                  <span className="ref">{r.buyer_name}</span>
                  <span className="meta">
                    {r.kecamatan} · {t('list.by', { name: who(r.created_by) })} · {fmtTime(r.created_at, lang)}
                    {' · '}{t('list.cancelledBy', { name: who(r.cancelled_by) })} · {fmtTime(r.cancelled_at, lang)}
                  </span>
                </span>
                <span />
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export default function Slots({ data, profile, t, lang, notify, goSetup }) {
  const role = profile.role;
  if (data.cities.length === 0) {
    if (role === 'admin') {
      return (
        <section className="panel">
          <h2>{t('nocity.admin.title')}</h2>
          <p className="hint">{t('nocity.admin.body')}</p>
          <div><button type="button" className="btn primary" onClick={goSetup}>{t('nocity.admin.btn')}</button></div>
        </section>
      );
    }
    return <section className="panel"><h2>{t('nocity.title')}</h2><p className="hint">{t('nocity.body')}</p></section>;
  }
  return data.cities.map((c) => (
    <CityCard key={c.id} city={c} rows={data.buyers[c.id] || []} role={role} me={profile}
      people={data.people} t={t} lang={lang} reload={data.reload} notify={notify} />
  ));
}
