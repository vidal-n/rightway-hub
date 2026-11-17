// The clarity audit meeting as one straight line (Nov 2026, V: Present mode must run first screen to last in the order of the pitch).
// Built from the research report "Audit meeting pitch framework": teach with the owner's own map (Challenger and RAIN, measured),
// discovery spread through the audit (SPIN, Gong 11 to 14 questions), an up front contract (Sandler), the order local grid vendors teach
// (strengths, grid reveal, who holds the spots, fixes, next step), price once at about three quarters of the meeting (Gong, 11,331 deals),
// and signing on the call (Proposify, 742,137 proposals). Every client screen carries one idea; the sentences live in the presenter notes,
// and every note ends in a question so no stretch runs past about 75 seconds without the owner talking (Gong: 76 seconds).
// Pure, shared by the deck (public/js/present.js) and the tests.

// [key, client facing title, start minute in a 45 minute meeting, what the screen is for (rep only)]
export const FLOW = [
  ['welcome', 'Plan for today', 0, 'Up front contract: they keep the audit either way and say yes or no at the end.'],
  ['verify', 'Your business on Google', 2, 'Discovery: about 6 open questions, fix keywords and towns.'],
  ['read', 'How to read the map', 8, 'Ten second legend, then a real strength.'],
  ['grid', 'Your map', 9.5, 'The reveal: the saved scan replays, run it live if you want.'],
  ['ahead', 'Who holds your spots', 17, 'The leader at the same spots and why they win.'],
  ['vs', 'You vs the leaders', 17, 'Fallback when there is no side by side yet.'],
  ['listings', 'Your listings', 21.5, 'Real directory mismatches.'],
  ['worth', 'What waiting costs', 24.5, 'Their own numbers, labeled an estimate.'],
  ['fixes', 'What we would fix first', 27, 'Two or three priorities, biggest gap first.'],
  ['plan', 'What gets you results', 28.5, 'The full scope with the research number on each line.'],
  ['days', 'Your first 90 days', 29.5, 'Month by month, honest timing.'],
  ['app', 'How it works', 30.5, 'Under 2 minutes of story, the app, what we need from them.'],
  ['trial', 'Questions before we talk investment', 32.5, 'Trial close.'],
  ['price', 'Your investment', 34, 'Price once: anchor, then the drop, exit terms out loud.'],
  ['sign', 'Work order', 38, 'Sign and pay on the call.'],
  ['next', 'What happens next', 41, 'Book onboarding, or a fixed follow up.'],
];

export const ORDER = FLOW.map(([k]) => k);
export const flowOf = (key) => FLOW.find(([k]) => k === key) || null;
export const titleOf = (key) => flowOf(key)?.[1] || key;
export const minuteOf = (key) => flowOf(key)?.[2] ?? null;
export const purposeOf = (key) => flowOf(key)?.[3] || '';

// Sort deck slides into the flow order; anything unknown keeps its place at the end.
export function inFlow(slides) {
  return [...slides].sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));
}

// "On time" check for the presenter: where the meeting should be at this screen, and how far ahead or behind the clock is.
export function pace(key, elapsedMin) {
  const at = minuteOf(key);
  if (at == null || !Number.isFinite(elapsedMin)) return null;
  const diff = Math.round(elapsedMin - at);
  return { at, diff, text: Math.abs(diff) <= 2 ? 'On time' : diff > 0 ? `${diff} min behind` : `${-diff} min ahead` };
}

// Gong's discovery numbers: 11 to 14 questions, spread out. About half on the business screen, the rest woven into the audit.
export const QUESTIONS = [
  'What kind of jobs do you want more of?',
  'Which towns or areas do you want work from?',
  'Where do most of your customers come from today?',
  'What is a typical job worth to you?',
  'About how many calls or leads do you get a week?',
  'What have you tried for marketing before, and how did it go?',
  'Who answers the phone when it rings?',
  'When you search your own service, where do you see yourself?',
  'If the phone rang more, could you handle the work?',
  'Who else helps you decide on something like this?',
];

// The up front contract, said on the first screen.
export const CONTRACT = 'By the end you will see exactly where you show up and why. If it makes sense we can talk about getting started, and if not, just tell me no. Fair?';
// Exit terms, printed and said out loud (risk reversal without promising a ranking).
export const EXIT_TERMS = ['3 month minimum, then month to month', '30 days notice to cancel after that', 'You own your profile and accounts', 'No ranking guarantees, every task shown in your app'];
