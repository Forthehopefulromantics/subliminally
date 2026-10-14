// Blog switches and fixed vocabulary.
//
// The blog is OFF unless BLOG_ENABLED=true. That variable is set only on the
// Vercel Preview environment, so merging this code to main does not by itself
// put a single blog URL on the live site: every /blog route answers 404 until
// someone deliberately sets it on Production.

export const SITE_URL = (process.env.BLOG_SITE_URL || 'https://www.subliminallybyfthr.com').replace(/\/$/, '');

export const BRAND = {
  name: 'The Subliminally Journal',
  tagline: 'A little knowledge. A lot of becoming.',
  mission: 'Accessible education about subliminals, affirmations, self-concept, manifestation, wellness, and intentional living.',
};

export function blogEnabled() {
  return process.env.BLOG_ENABLED === 'true';
}

/* Search engines may index only when the blog was deliberately switched on AND
   this is the production deployment AND BLOG_INDEXABLE is explicitly true.
   Anything else -- every preview, every local run -- is noindex, nofollow. */
export function indexable() {
  return blogEnabled() && process.env.VERCEL_ENV === 'production' && process.env.BLOG_INDEXABLE === 'true';
}

export function isStagingBanner() {
  return process.env.VERCEL_ENV !== 'production';
}

/* Real routes in the existing single-page app, confirmed in js/nav.js,
   js/boot.js and index.html. Do not add one that is not in the app. */
export const CTAS = {
  builder: {
    href: '/#build', label: 'Create Your Own Subliminal',
    blurb: 'The builder walks you through a frequency, your affirmations, a voice and ambience, one step at a time.',
  },
  affirmations: {
    href: '/#build', label: 'Write your affirmations in the builder',
    blurb: 'Draft, edit and hear your own affirmations while you build a subliminal.',
  },
  sleep: {
    href: '/#library', label: 'Open your saved subliminals',
    blurb: 'Everything you have built and saved lives in your library (the Mine tab), ready for bedtime.',
  },
  habits: {
    href: '/#rituals', label: 'Open the habit tracker',
    blurb: 'The habit tracker is part of the Ritual plan. Inside Rituals, the Habits tab lets you track a 21-day routine in one place.',
  },
  collections: {
    href: '/#library', label: 'Browse the library',
    blurb: 'Ready-made subliminals and the ones you have made, in one place.',
  },
};

export const CTA_KEYS = ['none', ...Object.keys(CTAS)];
export const STATUSES = ['draft', 'scheduled', 'published', 'archived'];

// Fallback if the categories table cannot be read (also used by the file store).
export const DEFAULT_CATEGORIES = [
  { slug: 'subliminals-101', name: 'Subliminals 101', sort_order: 1, description: 'Start here: what subliminals are, how they work, and how to make your own.' },
  { slug: 'affirmations', name: 'Affirmations', sort_order: 2, description: 'Writing affirmations that sound like you and that you can actually say.' },
  { slug: 'sleep-rituals', name: 'Sleep & Rituals', sort_order: 3, description: 'Nighttime listening, wind-down routines, and habits that stick.' },
  { slug: 'self-concept', name: 'Self-Concept', sort_order: 4, description: 'How you see yourself, and gentle ways to update the story.' },
  { slug: 'manifestation', name: 'Manifestation', sort_order: 5, description: 'Intention, belief, and practical action, kept honest.' },
  { slug: 'mind-science', name: 'Mind & Science', sort_order: 6, description: 'What research does and does not say, in plain language.' },
];

export const DEFAULT_AUTHOR = {
  name: 'The Subliminally Team',
  bio: 'Subliminally by FTHR helps you build a personal listening ritual. We write plainly about what is known, what is believed, and what is simply personal experience.',
};
