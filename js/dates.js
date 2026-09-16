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
