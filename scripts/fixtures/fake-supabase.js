(function(){
  const USER = { id:'u1', email:'test@example.com' };
  const SUBS = {
    A:{ id:'A', title:'Sub A', duration_seconds:600, frequency_hz:528, affirmations:['I am A one','I am A two'], background:'none', recording_urls:['A1.wav','A2.wav'] },
    B:{ id:'B', title:'Sub B', duration_seconds:600, frequency_hz:432, affirmations:['I am B one','I am B two'], background:'none', recording_urls:['B1.wav','B2.wav'] },
    C:{ id:'C', title:'Sub C', duration_seconds:600, frequency_hz:396, affirmations:['I am C one','I am C two'], background:'none', recording_urls:['C1.wav','C2.wav'] },
  };
  window.__rowDelay = { A:900, B:250, C:500 };
  window.__rowLoads = [];
  function builder(table){
    const q = { table, ops:[] };
    const p = new Proxy({}, { get(_, k){
      if (k === 'then') return (res, rej) => run(q).then(res, rej);
      return (...args) => { q.ops.push([k, args]); return p; };
    }});
    return p;
  }
  function run(q){
    const eq = Object.fromEntries(q.ops.filter(o=>o[0]==='eq').map(o=>o[1]));
    const single = q.ops.some(o=>o[0]==='maybeSingle'||o[0]==='single');
    const sel = (q.ops.find(o=>o[0]==='select')||[, ['']])[1][0] || '';
    if (q.table === 'subliminals'){
      if (single && eq.id){
        window.__rowLoads.push(eq.id);
        return new Promise(r => setTimeout(() => r({ data: SUBS[eq.id] || null, error:null }), window.__rowDelay[eq.id] || 0));
      }
      if (sel.includes('cover_path')) return Promise.resolve({ data: Object.values(SUBS).map(s=>({id:s.id, cover_path:null})), error:null });
      return Promise.resolve({ data: Object.values(SUBS).map(({id,title,duration_seconds})=>({id,title,duration_seconds})), error:null });
    }
    if (q.table === 'profiles' && single) return Promise.resolve({ data:{ id:'u1', full_name:'Tess Ter', username:'tess', onboarding_done:true, onboarded:true, tier:'ritual' }, error:null });
    return Promise.resolve({ data: single ? null : [], error:null, count:0 });
  }
  const client = {
    from: builder,
    rpc: () => Promise.resolve({ data:null, error:null }),
    auth: {
      getSession: () => Promise.resolve({ data:{ session:{ user:USER, access_token:'t' } } }),
      getUser: () => Promise.resolve({ data:{ user:USER } }),
      onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe(){} } } }),
      signOut: () => Promise.resolve({}),
    },
    storage: { from: (bucket) => ({
      createSignedUrl: (path) => Promise.resolve({ data:{ signedUrl: '/test-audio/' + path }, error:null }),
      upload: () => Promise.resolve({ data:null, error:null }),
    }) },
    functions: { invoke: () => Promise.resolve({ data:null, error:null }) },
    channel: () => ({ on(){ return this; }, subscribe(){ return this; } }),
    removeChannel(){},
  };
  window.supabase = { createClient: () => client };
})();
