// Script tests (Nov 2026, V: pick a script before dialing, track every call by script, split test to see what converts).
// Pure and shared by the Worker, the Hub and the tests. Modeled on Outreach's per prospect A/B assignment (even split, one
// variant per prospect, a new test after an edit) and Orum's conversation line (a connect with the owner that lasts 60 seconds).
// The winner is picked on ONE number: meetings booked per owner conversation. Show rate and closes are shown as checks only,
// because at a small team's volume they almost never reach a clear answer.

// Scripts a rep can dial with. The Clarity audit is the meeting itself, not a cold call script.
export const DIAL_SCRIPTS = ['analysis', 'question', 'cold', 'plan'];

// Before a winner is named: each script needs this many owner conversations, and the test needs to run this many days
// (two weeks covers both slow and busy days). 200 conversations per script can spot 10% vs 20% booked (alpha 0.05, power 0.8).
export const MIN_CONVS = 200;
export const MIN_DAYS = 14;
export const CONV_SECS = 60;

// Small, stable string hash (FNV-1a). Same input, same number, in the Worker and the browser.
export function hash(s) {
  let h = 0x811c9dc5;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// The version of a script: a short fingerprint of its words. Any edit makes a new version, so results never mix two texts.
export function versionOf(lines) {
  const text = (Array.isArray(lines) ? lines : [lines]).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).join('\n');
  return hash(text).toString(36).slice(0, 6);
}

// Split test: the same lead always gets the same script (per test), and every rep dials every script.
export function assign(testId, leadId, variants = []) {
  if (!variants.length) return null;
  if (variants.length === 1) return variants[0];
  return variants[hash(`${testId}:${leadId}`) % variants.length];
}

// What one call counts as. a = an activity row (outcome, answered_by, duration, answered_at).
const CONV_OUTCOMES = new Set(['booked', 'callback', 'conversation', 'not_interested', 'send_info', 'has_agency', 'not_fit']);
const NOBODY = new Set(['no_answer', 'voicemail', 'bad_number', 'phone_menu', 'wrong_number', 'dead']);
export function callFacts(a = {}) {
  const outcome = a.outcome || '';
  const by = a.answered_by || '';
  const booked = outcome === 'booked' || Boolean(a.bk); // bk: a meeting booked on that lead within 2 hours of the call (booking form during the call)
  const connect = Boolean(a.answered_at) || (by && !['voicemail', 'nobody', 'dead_line', 'phone_menu'].includes(by)) || (outcome && !NOBODY.has(outcome));
  const owner = booked || by === 'owner' || (!by && CONV_OUTCOMES.has(outcome));
  const conv = owner && (booked || CONV_OUTCOMES.has(outcome) || (Number(a.duration) || 0) >= CONV_SECS);
  return { dial: true, connect: Boolean(connect || booked), owner, conv, booked, fast: Boolean(connect) && (Number(a.duration) || 0) > 0 && (Number(a.duration) || 0) < 10 };
}

// Roll calls up by script (and version). rows: activities with script, script_v, by, at, plus the lead's stage, meet_at and client_id.
export function funnel(rows = [], { now = Date.now(), byVersion = false } = {}) {
  const out = new Map();
  const leadsBooked = new Map();
  for (const r of rows) {
    if (!r.script) continue;
    const key = byVersion ? `${r.script}@${r.script_v || '?'}` : r.script;
    let s = out.get(key);
    if (!s) { s = { key, script: r.script, version: byVersion ? r.script_v || '?' : null, dials: 0, connects: 0, owners: 0, convs: 0, booked: 0, held: 0, won: 0, fast: 0, first: r.at, last: r.at, reps: new Set(), objections: {} }; out.set(key, s); }
    const f = callFacts(r);
    s.dials++; if (f.connect) s.connects++; if (f.owner) s.owners++; if (f.conv) s.convs++; if (f.fast) s.fast++;
    if (r.objection) s.objections[r.objection] = (s.objections[r.objection] || 0) + 1;
    s.first = Math.min(s.first, r.at); s.last = Math.max(s.last, r.at);
    if (r.by) s.reps.add(r.by);
    if (f.booked) {
      s.booked++;
      // Show and close are counted once per lead, credited to the script whose call booked it.
      if (r.lead_id && !leadsBooked.has(r.lead_id)) {
        leadsBooked.set(r.lead_id, key);
        const met = r.meet_at && r.meet_at < now && !['no_show', 'audit_booked'].includes(r.stage);
        if (met || r.stage === 'won' || r.client_id) s.held++;
        if (r.stage === 'won' || r.client_id) s.won++;
      }
    }
  }
  return [...out.values()].map((s) => ({
    ...s, reps: s.reps.size, days: Math.max(1, Math.ceil((s.last - s.first) / 864e5)),
    rates: { connect: rate(s.connects, s.dials), conv: rate(s.convs, s.connects), book: rate(s.booked, s.convs), bookPerDial: rate(s.booked, s.dials), show: rate(s.held, s.booked), close: rate(s.won, s.held) },
  })).sort((a, b) => b.dials - a.dials);
}
const rate = (n, d) => (d ? n / d : 0);

// Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7).
export function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Two proportion z test (pooled). Returns z and the two sided p value.
export function zTest(x1, n1, x2, n2) {
  if (!n1 || !n2) return { z: 0, p: 1 };
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return { z: 0, p: 1 };
  const z = (x2 / n2 - x1 / n1) / se;
  return { z, p: 2 * (1 - phi(Math.abs(z))) };
}

// Chance that B's true rate beats A's (Beta(1+x, 1+n-x) for each, normal approximation of the difference).
export function chanceBetter(xA, nA, xB, nB) {
  const beta = (x, n) => { const a = 1 + x, b = 1 + n - x; return { m: a / (a + b), v: (a * b) / ((a + b) ** 2 * (a + b + 1)) }; };
  const A = beta(xA, nA), B = beta(xB, nB);
  const sd = Math.sqrt(A.v + B.v);
  return sd ? phi((B.m - A.m) / sd) : 0.5;
}

// Conversations each script needs to spot a change from p1 to p2 (alpha 0.05 two sided, power 0.8).
export function sampleSize(p1, p2, { za = 1.959964, zb = 0.841621 } = {}) {
  const d = Math.abs(p2 - p1);
  if (!d) return Infinity;
  const pb = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / d ** 2;
  return Math.ceil(n);
}

// 95% range for a rate (Wilson score interval), shown as "12% (8% to 17%)".
export function wilson(x, n, z = 1.959964) {
  if (!n) return [0, 0];
  const p = x / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// The verdict in plain words. Compares every script to the leader on booked per owner conversation.
// No winner before MIN_CONVS conversations each and MIN_DAYS days: peeking every day finds false winners about a quarter of the time.
export function verdict(stats = [], { minConvs = MIN_CONVS, minDays = MIN_DAYS, name = (k) => k } = {}) {
  const live = stats.filter((s) => s.dials > 0);
  if (live.length < 2) return { state: 'single', text: live.length ? 'Only one script has calls so far. Turn on a split test, or dial with another script, to compare.' : 'No calls with a script yet.', ranked: live };
  const ranked = [...live].sort((a, b) => b.rates.book - a.rates.book);
  const lead = ranked[0];
  const short = live.filter((s) => s.convs < minConvs);
  const days = Math.max(...live.map((s) => s.days));
  const vs = ranked.slice(1).map((s) => ({ key: s.key, chance: chanceBetter(s.booked, s.convs, lead.booked, lead.convs), ...zTest(s.booked, s.convs, lead.booked, lead.convs) }));
  const worst = vs.length ? Math.min(...vs.map((v) => v.chance)) : 0;
  if (short.length || days < minDays) {
    const need = short.map((s) => `${name(s.key)}: ${s.convs} of ${minConvs} conversations`).join(', ');
    return { state: 'collecting', text: `Not enough data yet${need ? ` (${need})` : ''}${days < minDays ? `, day ${days} of ${minDays}` : ''}. Keep dialing; early leads often flip.`, ranked, vs, leader: lead.key, chance: worst };
  }
  if (worst >= 0.95) return { state: 'winner', text: `${name(lead.key)} is likely better: about ${Math.round(worst * 100)}% sure it books more meetings per owner conversation.`, ranked, vs, leader: lead.key, chance: worst };
  if (worst >= 0.8) return { state: 'leaning', text: `${name(lead.key)} is leaning ahead (about ${Math.round(worst * 100)}% sure). Not proven yet.`, ranked, vs, leader: lead.key, chance: worst };
  const gap = Math.abs(lead.rates.book - (ranked[1]?.rates.book || 0));
  return { state: 'tie', text: gap < 0.02 ? 'Too close to matter. Keep the one reps like and test a bigger change.' : 'No clear difference yet.', ranked, vs, leader: lead.key, chance: worst };
}

// Test settings as saved (settings.script_test): { on, id, variants: [keys], started_at }.
export function cleanTest(t = {}, valid = DIAL_SCRIPTS) {
  const variants = [...new Set((Array.isArray(t.variants) ? t.variants : []).filter((k) => valid.includes(k)))].slice(0, 4);
  // allowPick: reps may still choose their own script while the test runs; those calls are tagged 'pick' and kept out of the test's numbers.
  return { on: Boolean(t.on) && variants.length >= 2, id: String(t.id || '').slice(0, 40) || null, variants, started_at: Number(t.started_at) || null, allowPick: t.allowPick !== false };
}
