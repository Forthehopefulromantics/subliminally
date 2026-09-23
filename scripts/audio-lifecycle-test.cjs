const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const builder = fs.readFileSync('js/builder.js','utf8');
const player = fs.readFileSync('js/player.js','utf8');
// All classic scripts share global function names: prevent the cleanup collision.
assert.equal((builder + player).match(/function stopAmbiencePreview\(/g).length, 1);
const output = builder.slice(builder.indexOf('function audioOut('), builder.indexOf('function primeAudio('));
async function checkOutput(ios, rejected){
  const routes = new Set();
  const ctx = {destination:{kind:'speaker'}, createGain:()=>({gain:{},connect:n=>routes.add(n),disconnect:n=>n?routes.delete(n):routes.clear()}),createMediaStreamDestination:()=>({kind:'element',stream:{}})};
  const sandbox={needsMediaElementOutput:()=>ios, Audio:class {setAttribute(){} play(){return rejected?Promise.reject(new Error('blocked')):Promise.resolve();} pause(){}}};
  vm.createContext(sandbox); vm.runInContext(output,sandbox);
  sandbox.audioOut(ctx);
  assert.equal(routes.size,1,'only one output while play is pending');
  await Promise.resolve();await Promise.resolve();
  assert.equal(routes.size,1,'only one output after resolution');
  assert.equal([...routes][0].kind,ios&&!rejected?'element':'speaker');
  sandbox.closeAudioOut(ctx);assert.equal(routes.size,0,'closing output disconnects all routes');
}
(async()=>{await checkOutput(false,false);await checkOutput(true,false);await checkOutput(true,true);console.log('PASS: unique preview cleanup; exclusive desktop/iOS/fallback output; complete disconnect');})().catch(e=>{console.error(e);process.exitCode=1;});

// Pause is authoritative: nothing advances while paused, resume continues the same line once.
(async()=>{
  const b = builder;
  const src = b.slice(b.indexOf('let finalCtx=null'), b.indexOf('function seekFinalAffirmation(')) +
    b.slice(b.indexOf('/* Play one loaded clip'), b.indexOf('let mediaRecorder')) +
    b.slice(b.indexOf('function primeAudio('), b.indexOf('function playFinal('));
  const log = [];
  class El { constructor(){ this.plays=0; } play(){ this.plays++; log.push('el.play'); return this.reject ? Promise.reject(Object.assign(new Error('abort'),{name:'AbortError'})) : Promise.resolve(); } pause(){ log.push('el.pause'); } }
  const ctx = { state:'running', suspend(){ this.state='suspended'; return Promise.resolve(); }, resume(){ log.push('ctx.resume'); this.state='running'; return Promise.resolve(); },
    createGain:()=>({gain:{value:1},connect(){}}), createMediaElementSource:()=>({connect(){}}), createBufferSource:()=>({connect(){},start(){}}), createBuffer:()=>({}), __outBus:{}, __outEl:new El() };
  const synth = { speaking:false, paused:false, pause(){ log.push('speech.pause'); }, resume(){ log.push('speech.resume'); }, cancel(){} };
  const sandbox = { AmbienceBed:class{}, window:{speechSynthesis:synth}, navigator:{}, document:{getElementById:()=>null}, setTimeout, clearTimeout, Date, Promise, audioOut:()=>ctx.__outBus,
    startSilentKeeper:()=>log.push('keeper.play'), stopSilentKeeper:()=>log.push('keeper.pause') };
  vm.createContext(sandbox); vm.runInContext(src + '\nthis.api={pauseFinal,resumeFinal,finalCallback,finalLater,playClip,primeAudio,get paused(){return finalPaused;},start(c){finalCtx=c;finalPlaying=true;finalSession++;},stop(){finalPlaying=false;finalSession++;finalPauseWaiters=[];}};', sandbox);
  const api = sandbox.api, tick = ms => new Promise(r => setTimeout(r, ms));
  api.start(ctx);
  let index = 0; const advance = api.finalCallback(() => { index++; });
  const el = new El(); el.reject = true;
  api.playClip(ctx, {kind:'element', el}, 1, null, advance);
  api.pauseFinal();
  await tick(5);
  assert.equal(api.paused, true); assert.equal(ctx.state, 'suspended');
  assert.equal(index, 0, 'a play() refused by the pause does not advance');
  advance(); advance(); api.finalLater(advance, 0); await tick(5);
  assert.equal(index, 0, 'callbacks and timers fired while paused do not advance the affirmation');
  api.primeAudio(); assert.equal(ctx.state, 'suspended', 'priming audio does not wake a paused session');
  el.reject = false; const outPlays = ctx.__outEl.plays;
  api.resumeFinal(); await tick(5);
  assert.equal(ctx.state, 'running'); assert.equal(el.plays, 2, 'the same element resumes; nothing new is created');
  assert.equal(ctx.__outEl.plays, outPlays + 1, 'iOS output element resumed once');
  assert.equal(index, 1, 'held callbacks run exactly once on resume');
  assert.ok(log.includes('speech.pause') && log.includes('speech.resume') && log.includes('el.pause'));
  const stale = api.finalCallback(() => { index += 100; }); api.stop(); api.start(ctx); stale(); await tick(5);
  assert.equal(index, 1, 'a callback from an earlier session never plays into the next');
  console.log('PASS: pause holds the affirmation; resume continues the same session once; stale callbacks dropped');
})().catch(e=>{console.error(e);process.exitCode=1;});
