-- The two answers the column never let anyone save.
--
-- profiles.faith was constrained to the six ids the question shipped with.
-- Two more have been offered on screen since -- 'universe' (Universe /
-- Manifestation) and 'psychology' (the secular, psychology-based language,
-- which onboarding also writes for "I prefer a secular approach") -- and
-- choosing either one failed the check, so the chip lit up, the save was
-- refused, and the answer was gone again on the next load.
--
-- Still a closed list: an id the app does not know behaves exactly like no
-- answer, and there is no reason to let one into the column. Nothing else about
-- the column changes, and no existing row is touched -- this only widens what
-- is allowed.

alter table public.profiles
  drop constraint if exists profiles_faith_known;

alter table public.profiles
  add constraint profiles_faith_known check (
    faith is null or faith in
      ('christianity','islam','hinduism','universe','spirituality',
       'psychology','agnostic','other')
  );
