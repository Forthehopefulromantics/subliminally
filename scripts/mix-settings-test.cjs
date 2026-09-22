const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const keys=['mixTone','mixBg','mixVoice','mixSoothing','mixCustom','mixLayerVoice'];
const elements=Object.fromEntries(keys.flatMap(k=>[[k,{value:'50'}],[k+'Val',{value:'50'}]]));
const status={textContent:''},rows=new Map(),writes=[];
let fail=false;
const context=vm.createContext({
  console:{error(){}},setTimeout,clearTimeout,Promise,
  document:{getElementById:id=>elements[id],querySelectorAll:s=>s==='[data-mix-status]'?[status]:[],addEventListener(){}},
  currentUser:{id:'user-a'},forgetFetch(){},applyLiveMixGain(){},
  sb:{from(){return {update(value){const filters={};return {eq(k,v){filters[k]=v;return this;},select(){return this;},async single(){
    if(fail)return {error:new Error('offline')};
    writes.push({filters,value});rows.set(filters.id,value.mix_settings);return {data:{id:filters.id}};
  }}}}}}
});
vm.runInContext(fs.readFileSync('js/mix-settings.js','utf8'),context);
const run=source=>vm.runInContext(source,context);
(async()=>{
  run("restoreMixSettings('a',{mixVoice:0,mixBg:58,mixTone:30,mixCustom:13,mixLayerVoice:22,mixSoothing:40})");
  assert.equal(elements.mixVoice.value,0,'mute must survive restore');
  await run('saveMixAdjustments()');
  assert.equal(rows.get('a').mixCustom,13);
  assert.equal(rows.get('a').mixVoice,0);
  assert.equal(writes[0].filters.user_id,'user-a');
  elements.mixVoice.value='42';run('queueMixSave()');
  await run('flushMixSave()');
  run("restoreMixSettings('b',{mixVoice:77})");
  assert.equal(elements.mixBg.value,50,'missing settings must not leak from track A');
  await run('saveMixAdjustments()');
  assert.equal(rows.get('a').mixVoice,42);assert.equal(rows.get('b').mixVoice,77);
  context.saved=rows.get('a');run("restoreMixSettings('a',saved)");
  assert.equal(elements.mixVoice.value,42,'reopen restores persisted values');
  fail=true;const saved=await run('saveMixAdjustments()');
  assert.equal(saved,false);assert.match(status.textContent,/could not be saved/);
  fail=false;
  elements.mixVoice.value='18';run('queueMixSave()');
  run("restoreMixSettings('b',{mixVoice:77})");await run('mixWriteQueue');
  assert.equal(rows.get('a').mixVoice,18,'switching must flush to original ID');
  assert.equal(rows.get('b').mixVoice,77);
  const profile=fs.readFileSync('js/profile.js','utf8');
  assert.equal((profile.match(/function renderNowBar\(/g)||[]).length,1);
  const bar=profile.slice(profile.indexOf('function renderNowBar(){'),profile.indexOf('/* The title of whatever',profile.indexOf('function renderNowBar(){')));
  assert.ok(!/>Open<|>Levels<|>Stop</.test(bar));
  assert.match(bar,/toggleImmersivePlayback/);assert.match(bar,/restartListening/);
  const player=fs.readFileSync('js/player.js','utf8');
  const prefs=player.slice(player.indexOf('function applyPlayerPrefs(){'),player.indexOf('function openImmersivePlayer(){'));
  assert.ok(!prefs.includes('setPlayerBalance('));
  console.log('PASS: all six volumes, mute, track isolation, reopen, switching during save, save failures, controls, preference override');
})().catch(e=>{console.error(e);process.exitCode=1});
