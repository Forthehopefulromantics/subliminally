(function(){
  const KEY='mockdb';
  const load=()=>JSON.parse(localStorage.getItem(KEY)||'{"tables":{},"storage":{}}');
  const save=db=>localStorage.setItem(KEY,JSON.stringify(db));
  const log=(e)=>{ const l=JSON.parse(localStorage.getItem('mocklog')||'[]'); l.push(e); localStorage.setItem('mocklog',JSON.stringify(l)); };
  const user={id:'user-1',email:'tester@example.com',user_metadata:{}};
  const session=()=>localStorage.getItem('mock_logged_in')==='0'?null:{user,access_token:'tok',refresh_token:'r',expires_at:9999999999};
  class Q{
    constructor(t){this.t=t;this.op='select';this.f=[];this.vals=null;this.mode='many';this.opts={};this.ord=null;this.lim=null;}
    select(c,o){ if(this.op==='select') this.opts=o||{}; return this; }
    insert(v){this.op='insert';this.vals=v;return this;}
    update(v){this.op='update';this.vals=v;return this;}
    upsert(v){this.op='upsert';this.vals=v;return this;}
    delete(){this.op='delete';return this;}
    eq(k,v){this.f.push(r=>r[k]===v);return this;}
    neq(k,v){this.f.push(r=>r[k]!==v);return this;}
    in(k,v){this.f.push(r=>v.includes(r[k]));return this;}
    gte(k,v){this.f.push(r=>r[k]>=v);return this;} lte(k,v){this.f.push(r=>r[k]<=v);return this;}
    gt(k,v){this.f.push(r=>r[k]>v);return this;} lt(k,v){this.f.push(r=>r[k]<v);return this;}
    is(k,v){this.f.push(r=>(r[k]??null)===v);return this;}
    order(k,o){this.ord=[k,!(o&&o.ascending===false)];return this;}
    limit(n){this.lim=n;return this;} range(){return this;} not(){return this;} or(){return this;} filter(){return this;} match(){return this;} ilike(){return this;} contains(){return this;}
    single(){this.mode='single';return this;} maybeSingle(){this.mode='maybe';return this;}
    then(res,rej){ return Promise.resolve().then(()=>this.exec()).then(res,rej); }
    exec(){
      // Test hook: localStorage.mockfail = [{table, op, n}] fails the next n matching calls.
      try {
        const fails=JSON.parse(localStorage.getItem('mockfail')||'[]'); const hit=fails.find(f=>f.table===this.t&&(!f.op||f.op===this.op)&&f.n>0);
        if(hit){ hit.n--; localStorage.setItem('mockfail',JSON.stringify(fails)); return {data:null,error:{message:'injected failure'}}; }
      } catch(e){}
      const db=load(); const rows=db.tables[this.t]=db.tables[this.t]||[]; let out;
      const match=r=>this.f.every(f=>f(r));
      if(this.op==='insert'||this.op==='upsert'){
        out=(Array.isArray(this.vals)?this.vals:[this.vals]).map(v=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),...JSON.parse(JSON.stringify(v))}));
        rows.push(...out);
      } else if(this.op==='update'){
        out=rows.filter(match); out.forEach(r=>Object.assign(r,JSON.parse(JSON.stringify(this.vals))));
      } else if(this.op==='delete'){
        out=rows.filter(match); db.tables[this.t]=rows.filter(r=>!match(r));
      } else {
        out=rows.filter(match);
        if(this.ord){ const [k,asc]=this.ord; out=out.slice().sort((a,b)=>(a[k]>b[k]?1:a[k]<b[k]?-1:0)*(asc?1:-1)); }
        if(this.lim) out=out.slice(0,this.lim);
      }
      if(this.op!=='select'){ save(db); log({table:this.t,op:this.op,vals:this.vals,n:out.length}); }
      if(this.opts.head) return {data:null,count:out.length,error:null};
      if(this.mode==='single') return out.length===1?{data:out[0],error:null}:{data:null,error:{message:'expected one row, got '+out.length}};
      if(this.mode==='maybe') return {data:out[0]||null,error:null};
      return {data:out,count:out.length,error:null};
    }
  }
  const toDataUrl=b=>new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b);});
  const bucket=name=>({
    async upload(path,blob){ const uf=JSON.parse(localStorage.getItem('mockfail')||'[]'); const uh=uf.find(f=>f.table==='storage-upload'&&f.n>0); if(uh){ uh.n--; localStorage.setItem('mockfail',JSON.stringify(uf)); return {data:null,error:{message:'injected upload failure'}}; } const db=load(); db.storage[name+'/'+path]=await toDataUrl(blob); save(db); log({storage:name,op:'upload',path}); return {data:{path},error:null}; },
    async createSignedUrl(path){ const u=load().storage[name+'/'+path]; return u?{data:{signedUrl:u},error:null}:{data:null,error:{message:'not found'}}; },
    async createSignedUrls(paths){ const s=load().storage; return {data:paths.map(p=>({path:p,signedUrl:s[name+'/'+p]||null})),error:null}; },
    async remove(paths){ return {data:paths,error:null}; },
    getPublicUrl(p){ return {data:{publicUrl:''}}; },
  });
  window.supabase={ createClient(){ return {
    from:t=>new Q(t),
    storage:{from:bucket},
    rpc:async(name,args)=>{
      if(name==='patch_subliminal_audio'){
        if(localStorage.getItem('mock_no_rpc')==='1') return {data:null,error:{message:'function patch_subliminal_audio does not exist'}};
        const fails=JSON.parse(localStorage.getItem('mockfail')||'[]'); const hit=fails.find(f=>f.table==='rpc'&&f.n>0);
        if(hit){ hit.n--; localStorage.setItem('mockfail',JSON.stringify(fails)); return {data:null,error:{message:'injected rpc failure'}}; }
        const db=load(); const row=(db.tables.subliminals||[]).find(r=>r.id===args.p_id&&r.user_id===user.id);
        if(!row) return {data:null,error:{message:'subliminal not found'}};
        const conflict=args.p_base_rev!=null&&args.p_base_rev<(row.audio_rev||0);
        row.mix_settings=Object.assign({},row.mix_settings||{},JSON.parse(JSON.stringify(args.p_patch)));
        row.audio_rev=(row.audio_rev||0)+1; row.audio_updated_at=new Date().toISOString();
        save(db); log({table:'subliminals',op:'rpc:patch_subliminal_audio',patch:args.p_patch,base:args.p_base_rev});
        return {data:[{audio_rev:row.audio_rev,mix_settings:row.mix_settings,conflict}],error:null};
      }
      return {data:null,error:null};
    },
    functions:{invoke:async()=>({data:null,error:null})},
    channel(){ const c={on(){return c;},subscribe(){return c;}}; return c; }, removeChannel(){},
    auth:{
      getSession:async()=>({data:{session:session()},error:null}),
      getUser:async()=>({data:{user:session()&&user},error:null}),
      onAuthStateChange(cb){ setTimeout(()=>cb(session()?'INITIAL_SESSION':'SIGNED_OUT',session()),0); return {data:{subscription:{unsubscribe(){}}}}; },
      signOut:async()=>{ localStorage.setItem('mock_logged_in','0'); return {error:null}; },
      signInWithPassword:async()=>{ localStorage.setItem('mock_logged_in','1'); return {data:{session:session()},error:null}; },
      updateUser:async()=>({data:{},error:null}), resend:async()=>({error:null}),
      exchangeCodeForSession:async()=>({data:{},error:null}),
    }
  }; } };
})();
