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
