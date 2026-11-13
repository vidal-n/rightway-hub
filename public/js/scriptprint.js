// The scripts as a reading copy: same text as the Hub's call prep, with blanks where call prep fills in the real names and numbers.
// Pure. Used by the Training page and by the printable PDFs, so paper, Training and the live call prep never drift apart.
import { catalogRows } from './rebuttals.js';
import { DEFAULT_SCRIPT, SCRIPT_KEYS, SCRIPT_GROUPS, DEFAULT_OBJECTIONS, voiceText } from './leadintel.js';

const B = (t) => `[[${t}]]`;
export const PRINT_VARS = {
  first: B('first name'), first_or_owner: B('first name'), rep: B('your name'), company: B('company name'), my_number: B('your number'), business: B('business'), city: B('city'),
  industry: B('industry'), keyword: B('keyword'),
  industry_q: 'How are most new customers finding you right now? (call prep shows the question for their trade)', industry_f1: 'Where did your last few new customers come from?', industry_f2: 'Is that the kind of work you want more of?',
  fruit_line: "It seems like there's some low hanging fruit here. I'd love to show you how the [industry] shops at the top of the map near you are getting their calls.", top_name_or_them: B('top competitor'), top10_of_points: B('X of Y'), ticket: B('job value'),
  price: B('monthly'), setup: B('buildout'), today_total: B('buildout + monthly'), city_suffix: ` in ${B('city')}`, pain: B('their pain'),
  scan_spread: `${B('spread line from call prep')} Same search, a couple of blocks apart, and you go from the first page to nowhere.`,
  services_list: B('the services on their quote'),
  price_anchor: `If we did everything we offer, every service and every area, it would be ${B('your top buildout')} to build out and ${B('your top monthly')} a month. (Pause.) But based on what you told me, you don't need all of that. I'm not going to sell you things you don't need. That's the whole reason I started this company.`,
  frame_scan: `the clarity audit we ran on ${B('business')}`,
  scan_meaning: `And honestly, ${B('first name')}, this is ${B('lower than I expected / better than most, but there are still holes')}. Usually what this tells me is that people who already know your name can find you, but people searching for the service, the ones who have never heard of you, are finding someone else.`,
  drop_offer: `OK, then let's right size it. I'd rather start you on what fits than not start you at all. We start with the core: your Google profile buildout, the listing cleanup, weekly posts, reviews and the monthly map. That's ${B('next lower price')} to build out and ${B('next lower price')} a month. We add the rest when the calls start coming. Does that work better?`,
  breakeven_jobs: `${B('X')} extra jobs`, breakeven: `${B('X')} jobs`,
  scan_line: `${B('scan line from call prep')}`,
  scan_intro: `Here's the clarity audit we ran on ${B('business')}.`,
  opener_reason: `We ran a Google clarity audit on ${B('business')} and found some inconsistencies in where you show up for "${B('keyword')}".`,
  gk_reason: `I/we looked ${B('business')} up on Google and put something together for ${B('first name')}. It's quick.`,
  hook_impact: `That means when someone in ${B('city')} needs "${B('keyword')}" today, a lot of them are calling ${B('top competitor')} before they ever see you.`,
  vm_scan: `I already ran part of yours. ${B('top competitor')} is showing up ahead of you in most of ${B('city')}.`,
  problems: B('the top 3 problems from call prep, one at a time'),
  site_intro: `IF THEY HAVE NO WEBSITE: Hey ${B('first name')}, look, so I/we actually couldn't find your website online, so I/we decided to sit down and just built you one... look ${B('first name')}, it's already done. You wanna see it?`,
  site_who: `(If they ask who this is:) Oh my bad, I'm ${B('your name')}, with RightWay Growth. We build websites for ${B('industry')} businesses around ${B('city')}.`,
  site_note: '(Only when their demo site is built and the link is ready.)',
  open_line: 'Hey, you guys are still open, right?',
  open_where: "(If they ask why:) Just wanted to make sure I caught you before you closed.",
  strategy_note: '',
  strategy_line: 'So I/we actually looked you guys up and used your info to build an **automated, tailored strategy** to help bring in more of the specific, profitable jobs you actually want.',
  found_say: `(If they ask what you found:) ${B('scan line from call prep')} And ${B('X of 15')} directories Google checks have you wrong or missing.`,
  value_line: `we can help you get more of the calls from people searching "${B('keyword')}" that are going to ${B('top competitor')} right now`,
  vm_line: `I/we looked ${B('business')} up on Google and put together a plan to bring in more of the profitable jobs.`,
  slot1: B('time 1'), slot2: B('time 2'), email_or_ask: B('their email'),
  listings_hook: `I also checked the directories Google uses to double check you, and ${B('X of 15')} have you wrong or missing, ${B('directory')} for one.`,
  listings_say: `And this isn't theory. On ${B('business')}, ${B('X')} of the 15 directories I checked have you wrong or missing. Let me show you.`,
};
export const fillPrint = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in PRINT_VARS ? PRINT_VARS[k] : m));
const title = Object.fromEntries(SCRIPT_KEYS.map(([k, t]) => [k, t.replace(/^Cold: /, '')]));
export const stepTitle = (k) => { const t = title[k] || k; return t.charAt(0).toUpperCase() + t.slice(1); };

// One script line: what kind it is and its text with blanks marked [[like this]].
export function classify(raw, voice = 'I') {
  const t = voiceText(fillPrint(String(raw).trim()), voice);
  let m;
  if ((m = t.match(/^\(SCREEN(, yours only)?: ([\s\S]*)\)$/))) return { kind: m[1] ? 'yourscreen' : 'screen', text: m[2] };
  if (/^\([\s\S]*\)$/.test(t)) return { kind: 'cue', text: t.slice(1, -1) };
  if ((m = t.match(/^(IF [A-Z ,]+):\s*([\s\S]*)$/))) return { kind: 'if', tag: m[1], text: m[2] };
  if ((m = t.match(/^Or: ([\s\S]*)$/))) return { kind: 'or', text: m[1] };
  if ((m = t.match(/^(\d+)\. ([\s\S]*)$/))) return { kind: 'q', n: m[1], text: m[2] };
  return { kind: 'say', text: t };
}
// Directions inside a spoken line, like "(Let them answer.)", get the same DO mark as a DO line, so nobody reads them out loud.
// Takes HTML that is already escaped. A few asides in parentheses are said out loud and stay as they are, and so does anything in
// parentheses that starts with a lowercase letter (V's own wording like "company(startup agency)" or "about (problem)" is spoken or a label, not a note).
const SPOKEN_ASIDE = /^(How many|No stress|end\b)/i;
const isCue = (inner) => !SPOKEN_ASIDE.test(inner.trim()) && !/^[a-z]/.test(inner.trim());
export function markCues(html) {
  return String(html).replace(/\(([^()]{2,240})\)/g, (m, inner) => (isCue(inner) ? `<span class="do-in"><b class="do-tag">Do</b>${inner.trim()}</span>` : m));
}
// ** marks bold. Takes HTML that is already escaped.
export const boldHtml = (html) => String(html).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
// Call prep and the live screens: DO marks plus bold.
export const rich = (html) => boldHtml(markCues(html));

// ---------- Reading copy in V's doc layout ----------
// Arial 14, one blank line between lines, centered bold underlined headings, italic underlined notes for the rep, brackets for blanks.
// One builder, so the Training page and the PDFs can never drift apart. Takes no HTML in, escapes everything it prints.
const e = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const brackets = (h) => h.replace(/\[\[(.+?)\]\]/g, '[$1]');
const docCues = (html) => String(html).replace(/\(([^()]{2,240})\)/g, (m, inner) => (isCue(inner) ? `<span class="d-cue">(${inner.trim()})</span>` : m));
const noteText = (t) => boldHtml(brackets(e(t)));
const spoken = (t) => boldHtml(docCues(brackets(e(t))));
export const DOC_TITLES = {
  question: ['COLD CALL SCRIPT:', 'QUESTION OPENER'], cold: ['COLD CALL SCRIPT'], analysis: ['COLD CALL SCRIPT:', 'COMPETITOR ANALYSIS'],
  plan: ['GAME PLAN SCRIPT:', 'WEBSITE AUDIT'], clarity: ['GOOGLE CLARITY AUDIT SCRIPT'],
};
export function docLine(l) {
  if (l.kind === 'screen') return `<p class="d-cue">Screen: ${noteText(l.text)}</p>`;
  if (l.kind === 'yourscreen') return `<p class="d-cue">Your screen: ${noteText(l.text)}</p>`;
  if (l.kind === 'cue') return `<p class="d-cue">${noteText(l.text)}</p>`;
  if (l.kind === 'if') return `<p><span class="d-cue">${e(l.tag)}:</span> ${spoken(l.text)}</p>`;
  if (l.kind === 'or') return `<p><span class="d-cue">Or:</span> ${spoken(l.text)}</p>`;
  if (l.kind === 'q') return `<p>${e(l.n)}. ${spoken(l.text)}</p>`;
  // A short quoted line (what the owner says) stays with its answer on paper.
  if (/^["\u201C\u201D].{0,110}["\u201C\u201D](\(\w+\))?$/.test(l.text)) return `<p class="d-q">${spoken(l.text)}</p>`;
  return `<p>${spoken(l.text)}</p>`;
}
// The objections that go on paper with a script.
const QUICK = ["I'm busy right now", 'Just send me an email', 'Are you with Google?', 'How did you get my number?', 'I already have someone handling my Google'];
export function docObjections(group, voice = 'I') {
  const og = Object.fromEntries(objectionGroups(undefined, voice).map(([k, , l]) => [k, l]));
  if (group === 'cold') {
    const quick = DEFAULT_OBJECTIONS.filter(([q]) => QUICK.includes(q)).map(([q, a]) => ({ q, a: voiceText(fillPrint(a), voice) }));
    return [['Objections', [...og.cold, ...quick]]];
  }
  if (group === 'question') return [['Mirror and label', og.ml]];
  if (group === 'clarity') return [['Objections before price', og.before], ['Objections after price', og.after], ['Objections any time', og.any]];
  return [];
}
export function docHtml(group, { voice = 'I', script = DEFAULT_SCRIPT, objections = false } = {}) {
  const head = (t) => `<h2 class="d-h">${e(t)}</h2>`;
  const titles = (DOC_TITLES[group] || [group.toUpperCase()]).map((t) => `<h1 class="d-title">${e(t)}</h1>`).join('');
  const steps = scriptSteps(group, script, voice).map((st) => `${head(`${st.title}:`)}${st.lines.map(docLine).join('')}`).join('');
  const obj = objections ? docObjections(group, voice).map(([name, list]) => `${head(`${name}:`)}${list.map((o) => `<p class="d-q">\u201C${boldHtml(e(o.q))}\u201D</p><p>${spoken(o.a)}</p>`).join('')}`).join('') : '';
  return `${titles}${steps}${obj}`;
}
export function scriptSteps(group, script = DEFAULT_SCRIPT, voice = 'I') {
  const g = SCRIPT_GROUPS.find((x) => x[0] === group);
  return (g ? g[2] : []).map((k) => ({ id: k, title: stepTitle(k), lines: String(script[k] || '').split('\n').filter((x) => x.trim()).map((x) => classify(x, voice)).filter((l) => l.text.trim()) }));
}
export function objectionGroups(list = DEFAULT_OBJECTIONS, voice = 'I') {
  const idx = (q) => list.findIndex(([x]) => x === q);
  const price = idx("It's too expensive"), any = idx('I need to talk to my partner or spouse');
  const cold = list.filter(([q]) => /^Cold: /.test(q));
  const rest = list.filter(([q]) => !/^Cold: /.test(q));
  const before = rest.filter(([q]) => idx(q) < price);
  const after = price >= 0 ? rest.filter(([q]) => idx(q) >= price && (any < 0 || idx(q) < any)) : [];
  const anytime = any >= 0 ? rest.filter(([q]) => idx(q) >= any) : [];
  const map = ([q, a]) => ({ q: q.replace(/^Cold: /, ''), a: voiceText(fillPrint(a), voice) });
  const ml = catalogRows((t) => voiceText(fillPrint(t), voice)).filter((x) => x.id !== 'remove').map((x) => ({ q: x.q, a: x.say }));
  return [['ml', 'Mirror and label', ml], ['cold', 'Cold call', cold.map(map)], ['before', 'Before price', before.map(map)], ['after', 'After price', after.map(map)], ['any', 'Any time', anytime.map(map)]];
}
