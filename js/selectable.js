/* selectable.js — the one rule for anything that can be chosen

   Part of Subliminally. A plain script, loaded before everything that draws a
   choice, so the rule lives in one place instead of being re-implemented per
   screen.

   THE RULE, and it is not negotiable:

     IF AN ELEMENT REPRESENTS A USER SELECTION, IT MUST ALWAYS VISUALLY SHOW
     WHETHER IT IS CURRENTLY SELECTED.

   The bug this exists to end is always the same shape. Somebody taps an option,
   something flashes under their finger, and then the card looks exactly like the
   two next to it. So they tap it again. The cause is always one of three
   things:

     1. the highlight was painted imperatively at the tap site, so anything that
        redraws that list -- a re-render, coming back from the next screen, a
        plan lookup finishing -- wipes it;
     2. the highlight waited on an await, so a slow network meant a tap that did
        nothing for a second and a half;
     3. appearance was tracked in a second variable next to the real answer, so
        the screen could show one thing while the state held another.

   The fix for all three is the same: the appearance is DERIVED from the state
   that actually decides the outcome, re-derived on every render, and applied
   synchronously at the moment of the tap.

   So the shape of every selectable list in this app is:

     state.thing = value;            // the real answer, written first
     renderThings();                 // redraws from state, never from the event

   and inside renderThings():

     syncSelection('#thingChips .chip', el => el.dataset.key === state.thing);

   Nothing here knows what a voice or a frequency is. It toggles one class and
   says the same thing to a screen reader, and that is the whole job. */

/* The class every stylesheet in this app already keys off. Kept as a constant so
   there is one spelling of it. */
const SELECTED_CLASS = 'sel';

/* Which attribute says "chosen" for this element, to anything that is not
   looking at the screen. A toggle-ish button says aria-pressed; something that
   is one of a set of mutually exclusive answers says aria-checked (radio) or
   aria-selected (option/tab). Reading it off the element's own role means the
   markup decides, and this never has to be told twice. */
function ariaSelectedAttr(el){
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'radio' || role === 'menuitemradio' || role === 'checkbox' || role === 'menuitemcheckbox') return 'aria-checked';
  if (role === 'option' || role === 'tab' || role === 'treeitem' || role === 'row') return 'aria-selected';
  if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) return null; // .checked is the truth
  return 'aria-pressed';
}

/* Mark one element selected or not. Class and ARIA together, always, so the two
   can never drift -- a card that looks chosen and reads as unchosen is the same
   bug wearing a different coat. */
function setSelected(el, selected){
  if (!el) return;
  const on = !!selected;
  el.classList.toggle(SELECTED_CLASS, on);
  const attr = ariaSelectedAttr(el);
  if (attr) el.setAttribute(attr, on ? 'true' : 'false');
  else el.checked = on;
}

/* Resolve whatever a caller passed into a list of elements: a selector string, a
   container element, a NodeList, or an array. Callers should not have to care. */
function selectableElements(group, itemSelector){
  if (!group) return [];
  if (typeof group === 'string') return Array.from(document.querySelectorAll(group));
  // nodeType rather than `instanceof Element`: this file is also loaded by the
  // test harness, and in a document from another frame `Element` is a different
  // constructor. The node type is the same everywhere.
  if (group.nodeType === 1) return itemSelector
    ? Array.from(group.querySelectorAll(itemSelector))
    : Array.from(group.children).filter(c => c && c.nodeType === 1);
  if (typeof group.length === 'number') return Array.from(group);
  return [];
}

/* THE CALL. Redraw a whole group's selected state from whatever the answer
   currently is.

   `isSelected` is a predicate over the element, so the caller writes the
   comparison against its own state and this stays ignorant. It is deliberately
   a whole-group pass rather than "light this one up": the previous answer going
   dark and the new one lighting up are one operation, and a single-select group
   that forgets half of it is how two cards end up looking chosen at once.

   Call it on every render of the list, not only on tap. That is what makes the
   highlight survive coming back to a screen, a re-render, or a restore out of
   Supabase. */
function syncSelection(group, isSelected, itemSelector){
  const els = selectableElements(group, itemSelector);
  els.forEach((el, i) => setSelected(el, !!isSelected(el, i)));
  return els;
}

/* The single most common case, spelled out so it does not have to be rewritten:
   one group, one data-attribute, one value. `syncSelectionByData('#bgGrid .bg-card', 'key', state.bg)` */
function syncSelectionByData(group, attr, value, itemSelector){
  return syncSelection(group, el => el.dataset[attr] === String(value), itemSelector);
}

/* Multi-select: everything whose value is in the chosen set stays lit. Takes an
   array or a Set, because both turn up in this codebase. */
function syncSelectionByDataIn(group, attr, values, itemSelector){
  const has = values instanceof Set ? (v) => values.has(v) : (v) => Array.from(values || []).includes(v);
  return syncSelection(group, el => has(el.dataset[attr]), itemSelector);
}

/* A group nobody has answered yet. Same pass, so it clears ARIA too rather than
   only stripping the class -- which is what `document.querySelectorAll('.sel')
   .forEach(c => c.classList.remove('sel'))` used to do at reset, leaving every
   chip on the page reading as "pressed" to a screen reader forever after. */
function clearSelection(group, itemSelector){
  return syncSelection(group, () => false, itemSelector);
}

if (typeof window !== 'undefined'){
  window.SELECTED_CLASS = SELECTED_CLASS;
  window.setSelected = setSelected;
  window.syncSelection = syncSelection;
  window.syncSelectionByData = syncSelectionByData;
  window.syncSelectionByDataIn = syncSelectionByDataIn;
  window.clearSelection = clearSelection;
}
