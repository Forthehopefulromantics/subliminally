/* faith-language.js — the saved faith answer, in words a generator can use.

   js/faith.js is the client's copy of this question: it holds the vocabulary
   the interface says out loud (what the higher thing is called, which habits
   are offered) and it owns the saved answer. This file is the other half —
   what the three generating endpoints are told about that answer before they
   write anything. Both are keyed by the same ids, and neither may invent one:
   an id this file does not recognise is read as no answer at all, which is the
   neutral framing, which is the same app.

   Nothing here is sent by the browser as prose. The endpoints receive an id and
   (for 'other' only) the short word the person typed for what they reach
   toward, and the framing is assembled here — so what reaches the model is
   this file's language rather than anything a request could put in its mouth. */

/* A framing, not a glossary. Swapping "God" for "the Universe" line by line
   produces sentences that belong to neither, so each entry describes how the
   writing should sound and lets the model write in it. */
const FAITH_LANGUAGE = {
  christianity: {
    label: 'Christianity',
    framing: `This person is Christian. Speak of God. Prayer is the practice they will recognise. Christian framing — grace, faith, being held, being led — is welcome where it fits the goal naturally. You may speak in the spirit of biblical teaching when it is relevant, but never quote or cite the Bible.`,
  },
  islam: {
    label: 'Islam',
    framing: `This person is Muslim. Speak of Allah. Prayer, and du'a where the moment calls for it, are the practices they will recognise. Islamic framing — reliance on Allah, patience, gratitude, intention — is welcome where it fits the goal naturally. You may speak in the spirit of Islamic teaching when it is relevant, but never quote or cite the Qur'an or hadith.`,
  },
  hinduism: {
    label: 'Hinduism',
    framing: `This person is Hindu. Use divine and spiritual terminology respectfully; meditation and prayer are both practices they will recognise, depending on what the goal asks for. Concepts such as dharma, steadiness of mind, and the divine already within may be drawn on where they fit the goal naturally. You may speak in the spirit of Hindu teaching when it is relevant, but never quote or cite the Gita, the Vedas, or any other text.`,
  },
  universe: {
    label: 'Universe / Manifestation',
    framing: `This person's language is manifestation. Speak of the Universe, alignment, intention, and what they are calling in; visualization is the practice they will recognise, and energy may be named where it fits. Keep it grounded — what they are becoming, not what is owed to them.`,
  },
  spirituality: {
    label: 'Spiritual, not religious',
    framing: `This person is spiritual but not religious. Speak of their higher self, their intuition, inner guidance, energy and alignment; meditation is the practice they will recognise. Do not use the language of any particular religion.`,
  },
  psychology: {
    label: 'Psychology / secular',
    framing: `This person prefers a secular, psychological framing. Speak of mindset, self-talk, reflection, habits and their own agency, in the plain language of evidence-based self-development. Make no religious or supernatural claims, and do not name any higher power — what changes here is what they practise and how they speak to themselves.`,
  },
  agnostic: {
    label: 'Not sure',
    framing: `This person has not settled the question. Use neutral, inclusive language and assume no religion. Nothing should imply what they ought to believe.`,
  },
  other: {
    label: 'Something else',
    framing: `This person's beliefs are their own and are not one of the traditions this app lists. Use neutral language and assume no religion.`,
  },
};

/* Said to every generator, whatever the answer is, including no answer. The
   first rule is the one that makes the rest work: everything below it is about
   what we refuse to put in somebody's mouth in the name of their own faith. */
const FAITH_CONTENT_RULES = `Rules about faith and belief, which override any stylistic instruction above:
- Never quote scripture. No Bible verses, no Qur'an verses, no lines from any sacred text, no sayings attributed to a religious figure, and no chapter-and-verse citations — not even ones you are confident of. Write in general faith-aligned language instead.
- Do not present any of this as religious doctrine, ruling or official teaching. It is one person's practice, not an authority speaking.
- Do not tell this person what to believe, and do not argue with what they believe.
- Do not swap a word for a word. The framing should read as though it was written in their language from the start.`;

/* What to tell a generator about this person, or null when there is nothing to
   say — in which case the caller leaves the section out rather than filling it
   with a guess. `word` is only ever used as a name: it is the forty characters
   somebody typed for what they reach toward, and we know nothing else about it. */
function faithFraming(faith, word) {
  const entry = FAITH_LANGUAGE[String(faith || '').trim()];
  if (!entry) return null;
  const named = (faith === 'other' && word)
    ? ` They call what they reach toward "${String(word).replace(/[^\p{L}\p{N} '’\-]/gu, '').trim().slice(0, 40)}"; use that name where a name is wanted, and neutral language everywhere else.`
    : '';
  return `How this person speaks about belief, which shapes the wording and the practices you suggest: ${entry.framing}${named}

${FAITH_CONTENT_RULES}`;
}

export { FAITH_LANGUAGE, FAITH_CONTENT_RULES, faithFraming };
