import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const EMPTY = { ready: false, cities: [], buyers: {}, people: {}, userCities: [], stamp: null, offline: false };

// Loads everything the signed-in person may see, and keeps it live.
// The database decides what each role can read, so the same queries work for all roles.
export function useData(role) {
  const [state, setState] = useState(EMPTY);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const citiesRes = await supabase.from('tradein_cities').select('*').order('name');
    if (citiesRes.error) {
      if (mine === seq.current) setState((s) => ({ ...s, offline: true }));
      return;
    }
    const cities = citiesRes.data || [];
    const lists = await Promise.all(
      cities.map((c) =>
        supabase.from('tradein_buyers').select('*').eq('city_id', c.id).order('created_at', { ascending: false }).limit(1000)
      )
    );
    const buyers = {};
    cities.forEach((c, i) => { buyers[c.id] = lists[i].data || []; });

    const people = {};
    if (role === 'admin' || role === 'manager') {
      const res = await supabase.from('tradein_profiles').select('*').order('full_name');
      (res.data || []).forEach((p) => { people[p.id] = p; });
    }
    let userCities = [];
    if (role === 'admin') {
      const res = await supabase.from('tradein_user_cities').select('*');
      userCities = res.data || [];
    }
    if (mine !== seq.current) return;
    setState({ ready: true, cities, buyers, people, userCities, stamp: new Date(), offline: false });
  }, [role]);

  useEffect(() => {
    if (!role || role === 'pending') { setState(EMPTY); return undefined; }
    load();

    let timer = null;
    const kick = () => { clearTimeout(timer); timer = setTimeout(load, 250); };

    // Live updates from the database.
    const channel = supabase
      .channel('live-slots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tradein_cities' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tradein_buyers' }, kick)
      .subscribe();

    // Backup: refresh every 30 seconds and when the phone comes back to the page.
    const poll = setInterval(load, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
      supabase.removeChannel(channel);
    };
  }, [role, load]);

  return { ...state, reload: load };
}
