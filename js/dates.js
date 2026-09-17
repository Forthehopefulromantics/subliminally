/* dates.js — what day it is, and how long a run of them is

   Part of Subliminally. Loaded first, because a day boundary is the one thing
   almost everything else needs: the builder, Light, habits and the calendar all
   ask what today is. In one file these hoisted above their callers; split
   across files they have to be loaded before them instead.

   A day is the person's own local day, not the server's — that is where their
   morning and night actually are. */

function localDateStr(d){
  const x = d || new Date();
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
}

function shiftDateStr(dateStr, days){
  const [y,m,d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(y, m-1, d+days));
}

function streakFromDays(daySet){
  let cursor = localDateStr();
  if (!daySet.has(cursor)) cursor = shiftDateStr(cursor, -1);
  let n = 0;
  while (daySet.has(cursor)){ n++; cursor = shiftDateStr(cursor, -1); }
  return n;
}

/* ---------- asking the network once ----------
   Every screen used to re-fetch everything it needed the moment it opened, so
   moving between two pages that both want your habits asked for them twice, and
   opening Today asked for your plan six times in one go. On a desk that reads
   as fine. On a phone, where a round trip to the database can take a second or
   more, thirty of them in a row is the difference between a tap that lands and
   a tap that appears to have done nothing.

   Two things fix most of it. `fetchOnce` remembers what an answer was for a
   short while and hands the same one back rather than asking again, and it
   hands a second caller the request already in flight instead of opening a new
   one. Anything that changes the answer calls `forgetFetch` to drop it.

   The window is deliberately short. This is a cache for the next few seconds of
   tapping around, not a store — a check-in you make on another device still
   shows up when you come back to the page a minute later. */
const FETCH_TTL_MS = 45000;
const _fetchAt = {}, _fetchVal = {}, _fetchIn = {};
function fetchOnce(key, fn, ttlMs){
  const ttl = ttlMs == null ? FETCH_TTL_MS : ttlMs;
  if (_fetchIn[key]) return _fetchIn[key];                 // already on its way — wait for that one
  if (_fetchAt[key] && Date.now() - _fetchAt[key] < ttl) return Promise.resolve(_fetchVal[key]);
  const p = Promise.resolve().then(fn).then(
    v => { _fetchAt[key] = Date.now(); _fetchVal[key] = v; delete _fetchIn[key]; return v; },
    e => { delete _fetchIn[key]; throw e; }                 // a failure is not an answer; ask again next time
  );
  _fetchIn[key] = p;
  return p;
}
function forgetFetch(key){
  if (key == null){ Object.keys(_fetchAt).forEach(forgetFetch); return; }
  delete _fetchAt[key]; delete _fetchVal[key]; delete _fetchIn[key];
}
function fetchIsFresh(key, ttlMs){
  const ttl = ttlMs == null ? FETCH_TTL_MS : ttlMs;
  return !!(_fetchAt[key] && Date.now() - _fetchAt[key] < ttl);
}
