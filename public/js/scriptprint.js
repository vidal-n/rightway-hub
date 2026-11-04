// The scripts as a reading copy: same text as the Hub's call prep, with blanks where call prep fills in the real names and numbers.
// Pure. Used by the Training page and by the printable PDFs, so paper, Training and the live call prep never drift apart.
import { DEFAULT_SCRIPT, SCRIPT_KEYS, SCRIPT_GROUPS, DEFAULT_OBJECTIONS } from './leadintel.js';

const B = (t) => `[[${t}]]`;
export const PRINT_VARS = {
  first: B('first name'), first_or_owner: B('first name'), rep: B('your name'), my_number: B('your number'), business: B('business'), city: B('city'),
  industry: B('industry'), keyword: B('keyword'), top_name_or_them: B('top competitor'), top10_of_points: B('X of Y'), ticket: B('job value'),
  price: B('monthly'), setup: B('buildout'), today_total: B('buildout + monthly'), city_suffix: ` in ${B('city')}`, pain: B('their pain'),
  scan_spread: `${B('spread line from call prep')} Same search, a couple of blocks apart, and you go from the first page to nowhere.`,
  services_list: B('the services on their quote'),
  price_anchor: "If we did everything we offer, every service and every area, it would be $599 to build out and $599 a month. (Pause.) But based on what you told me, you don't need all of that. I'm not going to sell you things you don't need. That's the whole reason I started this company.",
  frame_scan: `the clarity audit I ran on ${B('business')}`,
  scan_meaning: `And honestly, ${B('first name')}, this is ${B('lower than I expected / better than most, but there are still holes')}. Usually what this tells me is that people who already know your name can find you, but people searching for the service, the ones who have never heard of you, are finding someone else.`,
  drop_offer: `OK, then let's right size it. I'd rather start you on what fits than not start you at all. We start with the core: your Google profile buildout, the listing cleanup, weekly posts, reviews and the monthly map. That's ${B('next lower price')} to build out and ${B('next lower price')} a month. We add the rest when the calls start coming. Does that work better?`,
  breakeven_jobs: `${B('X')} extra jobs`, breakeven: `${B('X')} jobs`,
  scan_line: `${B('scan line from call prep')}`,
  scan_intro: `Here's the clarity audit I ran on ${B('business')}.`,
  opener_reason: `I ran a Google clarity audit on ${B('business')} and found some inconsistencies in where you show up for "${B('keyword')}".`,
  gk_reason: `I ran a Google clarity audit on ${B('business')} and I need two minutes with the owner about what I found.`,
  hook_impact: `That means when someone in ${B('city')} needs "${B('keyword')}" today, a lot of them are calling ${B('top competitor')} before they ever see you.`,
  vm_scan: `I already ran part of yours. ${B('top competitor')} is showing up ahead of you in most of ${B('city')}.`,
  problems: B('the top 3 problems from call prep, one at a time'),
  slot1: B('time 1'), slot2: B('time 2'), email_or_ask: B('their email'),
  listings_hook: `I also checked the directories Google uses to double check you, and ${B('X of 15')} have you wrong or missing, ${B('directory')} for one.`,
  listings_say: `And this isn't theory. On ${B('business')}, ${B('X')} of the 15 directories I checked have you wrong or missing. Let me show you.`,
};
export const fillPrint = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in PRINT_VARS ? PRINT_VARS[k] : m));
const title = Object.fromEntries(SCRIPT_KEYS.map(([k, t]) => [k, t.replace(/^Cold: /, '')]));
export const stepTitle = (k) => { const t = title[k] || k; return t.charAt(0).toUpperCase() + t.slice(1); };

// One script line: what kind it is and its text with blanks marked [[like this]].
export function classify(raw) {
  const t = fillPrint(String(raw).trim());
  let m;
  if ((m = t.match(/^\(SCREEN(, yours only)?: ([\s\S]*)\)$/))) return { kind: m[1] ? 'yourscreen' : 'screen', text: m[2] };
  if (/^\([\s\S]*\)$/.test(t)) return { kind: 'cue', text: t.slice(1, -1) };
  if ((m = t.match(/^(IF [A-Z ,]+):\s*([\s\S]*)$/))) return { kind: 'if', tag: m[1], text: m[2] };
  if ((m = t.match(/^Or: ([\s\S]*)$/))) return { kind: 'or', text: m[1] };
  if ((m = t.match(/^(\d+)\. ([\s\S]*)$/))) return { kind: 'q', n: m[1], text: m[2] };
  return { kind: 'say', text: t };
}
export function scriptSteps(group, script = DEFAULT_SCRIPT) {
  const g = SCRIPT_GROUPS.find((x) => x[0] === group);
  return (g ? g[2] : []).map((k) => ({ id: k, title: stepTitle(k), lines: String(script[k] || '').split('\n').filter((x) => x.trim()).map(classify) }));
}
export function objectionGroups(list = DEFAULT_OBJECTIONS) {
  const idx = (q) => list.findIndex(([x]) => x === q);
  const price = idx("It's too expensive"), any = idx('I need to talk to my partner or spouse');
  const cold = list.filter(([q]) => /^Cold: /.test(q));
  const rest = list.filter(([q]) => !/^Cold: /.test(q));
  const before = rest.filter(([q]) => idx(q) < price);
  const after = price >= 0 ? rest.filter(([q]) => idx(q) >= price && (any < 0 || idx(q) < any)) : [];
  const anytime = any >= 0 ? rest.filter(([q]) => idx(q) >= any) : [];
  const map = ([q, a]) => ({ q: q.replace(/^Cold: /, ''), a: fillPrint(a) });
  return [['cold', 'Cold call', cold.map(map)], ['before', 'Before price', before.map(map)], ['after', 'After price', after.map(map)], ['any', 'Any time', anytime.map(map)]];
}
