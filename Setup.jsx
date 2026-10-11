import { useState } from 'react';
import { supabase, callUsers } from '../supabase';
import { apiMessage } from '../i18n';

const toList = (text) => {
  const seen = new Set();
  return String(text || '')
    .split(/\r?\n|,/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length >= 2 && s.length <= 60 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
};
const validLimit = (n) => Number.isInteger(n) && n >= 1 && n <= 1000;

function CityRow({ city, t, reload, notify }) {
  const [name, setName] = useState(city.name);
  const [limit, setLimit] = useState(String(city.buyer_limit));
  const [kecText, setKecText] = useState((city.kecamatan || []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = `city-${city.id}`;

  async function save() {
    const n = parseInt(limit, 10);
    if (!name.trim()) { setErr(t('setup.err.cityName')); return; }
    if (!validLimit(n)) { setErr(t('setup.err.limit')); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('tradein_cities')
      .update({ name: name.trim(), buyer_limit: n, kecamatan: toList(kecText) }).eq('id', city.id);
    setBusy(false);
    if (error) { setErr(error.code === '23505' ? t('setup.err.cityDup') : t('api.generic')); return; }
    notify(n < city.used ? t('setup.savedLow', { n: city.used }) : t('setup.saved'));
    reload();
  }

  async function toggle() {
    setBusy(true); setErr('');
    const { error } = await supabase.from('tradein_cities').update({ is_open: !city.is_open }).eq('id', city.id);
    setBusy(false);
    if (error) { setErr(t('api.generic')); return; }
    notify(city.is_open ? t('setup.closed') : t('setup.opened'));
    reload();
  }

  return (
    <li>
      <div className="row">
        <div className="field">
          <label htmlFor={`${id}-name`}>{t('setup.city')}</label>
          <input id={`${id}-name`} type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field narrow">
          <label htmlFor={`${id}-limit`}>{t('limit')}</label>
          <input id={`${id}-limit`} type="number" inputMode="numeric" min={1} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-kec`}>{t('setup.kecList')}</label>
        <textarea id={`${id}-kec`} rows={4} value={kecText} onChange={(e) => setKecText(e.target.value)} />
        <span className="sub">{t('setup.kecList.hint')}</span>
      </div>
      <div className="row center">
        <button type="button" className="btn" disabled={busy} onClick={save}>{t('setup.save')}</button>
        <button type="button" className="btn" disabled={busy} onClick={toggle}>{city.is_open ? t('setup.close') : t('setup.open')}</button>
        <span className="sub">{t('setup.usedCount', { n: city.used })}{city.is_open ? '' : ` · ${t('st.closed')}`}</span>
      </div>
      <p className="err" role="alert">{err}</p>
    </li>
  );
}

function NewCity({ first, t, reload, notify }) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [kecText, setKecText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    const n = parseInt(limit, 10);
    if (!name.trim()) { setErr(t('setup.err.cityName')); return; }
    if (!validLimit(n)) { setErr(t('setup.err.limit')); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('tradein_cities').insert({ name: name.trim(), buyer_limit: n, kecamatan: toList(kecText) });
    setBusy(false);
    if (error) { setErr(error.code === '23505' ? t('setup.err.cityDup') : t('api.generic')); return; }
    notify(t('setup.cityAdded', { name: name.trim() }));
    setName(''); setLimit(''); setKecText('');
    reload();
  }

  return (
    <form onSubmit={submit} noValidate className="sub-form">
      <h3>{first ? t('setup.addPilot') : t('setup.addCity')}</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="nc-name">{t('setup.city')}</label>
          <input id="nc-name" type="text" maxLength={40} placeholder={t('setup.city.ph')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field narrow">
          <label htmlFor="nc-limit">{t('limit')}</label>
          <input id="nc-limit" type="number" inputMode="numeric" min={1} max={1000} placeholder="100" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="nc-kec">{t('setup.kecList')}</label>
        <textarea id="nc-kec" rows={4} value={kecText} onChange={(e) => setKecText(e.target.value)} />
        <span className="sub">{t('setup.kecList.hint')}</span>
      </div>
      <p className="err" role="alert">{err}</p>
      <div><button className="btn primary" disabled={busy}>{t('setup.addCity')}</button></div>
    </form>
  );
}

function RoleAndCities({ idBase, role, setRole, cityIds, setCityIds, cities, t }) {
  const toggle = (cid) => {
    if (role === 'sales') setCityIds(cityIds.includes(cid) ? [] : [cid]);
    else setCityIds(cityIds.includes(cid) ? cityIds.filter((x) => x !== cid) : [...cityIds, cid]);
  };
  const pickRole = (r) => { setRole(r); if (r === 'sales' && cityIds.length > 1) setCityIds(cityIds.slice(0, 1)); };
  return (
    <>
      <div className="field role-field">
        <label htmlFor={`${idBase}-role`}>{t('setup.role')}</label>
        <select id={`${idBase}-role`} value={role} onChange={(e) => pickRole(e.target.value)}>
          <option value="sales">{t('role.sales')}</option>
          <option value="manager">{t('role.manager')}</option>
        </select>
      </div>
      {cities.length === 0 ? <p className="sub">{t('setup.needCityFirst')}</p> : (
        <fieldset>
          <legend>{t('setup.cityPick')}</legend>
          <div className="chks">
            {cities.map((c) => (
              <label className="chk" key={c.id}>
                <input type="checkbox" checked={cityIds.includes(c.id)} onChange={() => toggle(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

function PersonRow({ person, assigned, cities, t, reload, notify }) {
  const [fullName, setFullName] = useState(person.full_name || '');
  const [role, setRole] = useState(person.role === 'manager' ? 'manager' : 'sales');
  const [cityIds, setCityIds] = useState(assigned);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = `p-${person.id}`;

  async function act(action, payload, okMsg) {
    setBusy(true); setErr('');
    const res = await callUsers(action, { id: person.id, ...payload });
    setBusy(false);
    if (res.error) { setErr(apiMessage(t, res.error)); return false; }
    notify(okMsg);
    reload();
    return true;
  }

  return (
    <li>
      <div className="p-head">
        <div>
          <strong>{person.full_name || person.username}</strong>
          <span className="sub mono">{person.username}</span>
          {person.role === 'pending' && <span className="tag">{t('role.pending')}</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-name`}>{t('setup.fullName')}</label>
        <input id={`${id}-name`} type="text" maxLength={80} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <RoleAndCities idBase={id} role={role} setRole={setRole} cityIds={cityIds} setCityIds={setCityIds} cities={cities} t={t} />
      <div className="row center">
        <button type="button" className="btn" disabled={busy}
          onClick={() => act('update', { full_name: fullName, role, city_ids: cityIds }, t('setup.saved'))}>{t('setup.save')}</button>
        {person.role !== 'pending' && (
          <button type="button" className="btn" disabled={busy}
            onClick={async () => { if (await act('remove_access', {}, t('setup.accessRemoved'))) setCityIds([]); }}>{t('setup.removeAccess')}</button>
        )}
      </div>
      {person.username.includes('@') ? (
        <p className="sub">{t('setup.linkedNote')}</p>
      ) : (
        <div className="row end">
          <div className="field">
            <label htmlFor={`${id}-pass`}>{t('setup.newPass')}</label>
            <input id={`${id}-pass`} type="text" autoComplete="off" autoCapitalize="none" spellCheck="false" maxLength={72}
              value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          <button type="button" className="btn" disabled={busy || !pass}
            onClick={async () => { if (await act('reset_password', { password: pass }, t('setup.passDone'))) setPass(''); }}>{t('setup.resetPass')}</button>
        </div>
      )}
      <p className="err" role="alert">{err}</p>
    </li>
  );
}

function NewPerson({ cities, t, reload, notify }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('sales');
  const [cityIds, setCityIds] = useState(cities.length === 1 ? [cities[0].id] : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const res = await callUsers('create', { full_name: fullName, username, password, role, city_ids: cityIds });
    setBusy(false);
    if (res.error) { setErr(apiMessage(t, res.error)); return; }
    notify(t(res.linked ? 'setup.userLinked' : 'setup.userAdded', { name: username.trim().toLowerCase() }));
    setFullName(''); setUsername(''); setPassword('');
    reload();
  }

  // An email means "this person already has a login here": no new password is set.
  const linking = username.includes('@');

  return (
    <form onSubmit={submit} noValidate className="sub-form">
      <h3>{t('setup.addUser')}</h3>
      <div className="field">
        <label htmlFor="np-name">{t('setup.fullName')}</label>
        <input id="np-name" type="text" maxLength={80} placeholder={t('setup.fullName.ph')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="np-user">{t('setup.userOrEmail')}</label>
          <input id="np-user" type="text" maxLength={120} autoComplete="off" autoCapitalize="none" spellCheck="false"
            placeholder={t('setup.username.ph')} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        {!linking && (
          <div className="field">
            <label htmlFor="np-pass">{t('login.pass')}</label>
            <input id="np-pass" type="text" maxLength={72} autoComplete="off" autoCapitalize="none" spellCheck="false"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
      </div>
      <p className="sub">{t(linking ? 'setup.linkHint' : 'setup.userHint')}</p>
      <RoleAndCities idBase="np" role={role} setRole={setRole} cityIds={cityIds} setCityIds={setCityIds} cities={cities} t={t} />
      <p className="err" role="alert">{err}</p>
      <div><button className="btn primary" disabled={busy || cities.length === 0}>{t('setup.addUser')}</button></div>
    </form>
  );
}

export default function Setup({ data, profile, t, notify }) {
  const { cities, people, userCities, reload } = data;
  const others = Object.values(people)
    .filter((p) => p.id !== profile.id && p.role !== 'admin')
    .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));
  const assignedOf = (id) => userCities.filter((u) => u.user_id === id).map((u) => u.city_id);

  return (
    <>
      <section className="panel">
        <h2>{t('setup.cities')}</h2>
        <p className="hint">{t('setup.cities.hint')}</p>
        {cities.length > 0 && (
          <ul className="list">
            {cities.map((c) => <CityRow key={c.id} city={c} t={t} reload={reload} notify={notify} />)}
          </ul>
        )}
        <NewCity first={cities.length === 0} t={t} reload={reload} notify={notify} />
      </section>

      <section className="panel">
        <h2>{t('setup.people')}</h2>
        <p className="hint">{t('setup.people.hint')}</p>
        {others.length === 0 ? <p className="none">{t('setup.noPeople')}</p> : (
          <ul className="list">
            {others.map((p) => (
              <PersonRow key={`${p.id}:${p.role}:${assignedOf(p.id).join(',')}`} person={p} assigned={assignedOf(p.id)}
                cities={cities} t={t} reload={reload} notify={notify} />
            ))}
          </ul>
        )}
        <NewPerson key={cities.length} cities={cities} t={t} reload={reload} notify={notify} />
      </section>
    </>
  );
}
