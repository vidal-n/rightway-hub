// Life-Force 8 (Drew Eric Whitman, Cashvertising): the eight things every person is wired to want. We use them to make waiting feel as real as it is.
// Pure. Rules that never bend:
//  - a line only appears when a real number from the research backs it (no invented deadlines, discounts, scarcity or call counts);
//  - nothing promises a ranking (rank also depends on distance and relevance);
//  - desires that do not fit a business sale are skipped, and the result says which and why.
// `lines` are safe for the client's screen. `asks` are questions for the closer to say out loud (presenter notes only).

export const LF8 = [
  { id: 'survive', name: 'Survival, enjoyment of life, life extension', fit: 'The business staying alive and the phone staying busy.' },
  { id: 'food', name: 'Enjoyment of food and beverages', fit: 'Restaurants, bars, cafes and food trucks only.' },
  { id: 'fear', name: 'Freedom from fear, pain and danger', fit: 'Losing jobs to a competitor, and a rating that scares people off.' },
  { id: 'sex', name: 'Sexual companionship', fit: 'Does not fit selling local marketing to a business owner, so it is not used.', skip: true },
  { id: 'comfort', name: 'Comfortable living conditions', fit: 'What a few more jobs a month means at home.' },
  { id: 'superior', name: 'To be superior, winning, keeping up with the Joneses', fit: 'The competitor down the street who is ahead.' },
  { id: 'loved', name: 'Care and protection of loved ones', fit: 'The family and the crew that depend on the business.' },
  { id: 'approval', name: 'Social approval', fit: 'What neighbors see in the reviews before they call.' },
];

const FOOD = /restaurant|cafe|coffee|bakery|pizza|taco|grill|bar\b|catering|food|diner|deli|brewery/i;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ctx: { business, industry, grid: { points, top10, top3 } | null, you: { reviews, rating, rank }, top: { name, reviews, rating, wins } | null, gap: reviews behind the leader | null }
export function urgencyFor(ctx = {}) {
  const { business = 'the business', industry = '', grid = null, you = {}, top = null } = ctx;
  const lines = [], asks = [], skipped = [];
  const push = (id, line, ask) => { if (line) lines.push({ id, line }); if (ask) asks.push({ id, ask }); };

  const lost = grid && grid.points ? grid.points - (grid.top10 || 0) : 0;
  if (lost > 0) push('survive', `In ${lost} of the ${grid.points} spots we checked around ${business}, a customer searching does not see you on the first page. Each of those searches is a call that goes to someone else.`,
    'How many more calls a week would it take to keep your schedule full?');
  else push('survive', '', 'What does a slow week do to you, and how often does that happen?');

  if (top && top.wins > 0 && grid?.points) push('fear', `${top.name} is in the top 3 in ${top.wins} of the ${grid.points} spots we checked. That is the share of the area that sees them first.`,
    `When you see ${top.name} above you, what worries you most?`);
  else if (you.rating != null && you.rating < 4.3) push('fear', `Your rating is ${Number(you.rating).toFixed(1)}. Many customers skip anything under 4.3 stars before they ever call.`, 'How does a bad review land with you when it shows up?');
  else push('fear', '', 'What worries you most about where you show up on Google right now?');

  if (top && top.reviews != null && you.reviews != null && top.reviews > you.reviews) push('superior', `${top.name} has ${plural(top.reviews - you.reviews, 'more Google review')} than ${business} (${top.reviews} vs ${you.reviews}).`,
    'Is their work really better than yours? So why do they get the first look?');
  else if (top && grid?.top3 > (top.wins || 0)) push('superior', `You are in the top 3 in ${grid.top3} of the ${grid.points} spots, more than ${top.name}. The plan is to hold that and widen it.`, 'What would it mean to be the name everyone in town sees first?');
  else push('superior', '', 'Who in your town do you wish you were beating on Google?');

  if (you.reviews != null && (you.reviews < 25 || (you.rating != null && you.rating < 4.5))) push('approval', `Before they call, your neighbors read the reviews. What they see for ${business} is ${plural(you.reviews, 'review')} at ${you.rating != null ? `${Number(you.rating).toFixed(1)} stars` : 'no rating yet'}.`,
    'When you pick a plumber or a dentist, do you look at the reviews first?');
  else push('approval', '', 'What do your best customers say about you when they refer you?');

  push('comfort', '', 'If you picked up a few more jobs a month, what would that change for you at home?');
  push('loved', '', 'Who depends on this business besides you, your family, your crew?');

  if (FOOD.test(industry)) push('food', 'People deciding where to eat tonight search "near me" and go to one of the first few places they see.', 'On a slow night, how many tables are empty?');
  else skipped.push({ id: 'food', why: 'Not a food or drink business.' });
  skipped.push({ id: 'sex', why: LF8.find((x) => x.id === 'sex').fit });
  return { lines, asks, skipped };
}
