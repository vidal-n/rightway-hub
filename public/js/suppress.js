// The Do Not Call list (suppression list), pure and shared by the Worker, the browser and tests.
// Modeled on the suppression lists in Apollo.io, Outreach and Close (a list kept apart from the leads, so a lead can be deleted and
// still never come back or get dialed) and on the Do Not Contact lists in ZoomInfo and Outscraper exports. Dedupe keys are the same
// `dupKeys` the importer uses (phone, website domain, business name plus place), so a re-scrape of the same business is caught
// whichever way it shows up.
import { dupKeys } from './leadintel.js';

// What each reason does. `all`: every key of the business blocks calls and texts (the business is off limits).
// `phoneOnly`: only that phone number blocks; the business stays known so it is not scraped again, but a different working number
// found later is still reachable by hand. `dedupeOnly`: blocks nothing, only keeps the business from being added twice.
// `email`: also stops email and automatic workflows (a request not to be contacted).
export const REASONS = {
  dnc: { label: 'Asked not to be called', short: 'Do not call', all: true, email: true, legal: true, color: 'var(--c-coral)' },
  registry: { label: 'On a do not call registry', short: 'Registry', all: true, email: true, legal: true, color: 'var(--c-amber)' },
  dead: { label: 'Dead lead, not interested', short: 'Dead lead', all: true, email: false, legal: false, color: 'var(--c-slate)' },
  bad_number: { label: 'Bad or wrong number', short: 'Bad number', phoneOnly: true, email: false, legal: false, color: 'var(--c-violet)' },
  phone_menu: { label: 'Phone menu, nobody to reach', short: 'Phone menu', phoneOnly: true, email: false, legal: false, color: 'var(--c-blue)' },
  deleted: { label: 'Deleted from the Hub', short: 'Deleted', dedupeOnly: true, email: false, legal: false, color: 'var(--c-teal)' },
};
export const REASON_IDS = Object.keys(REASONS);
// Reasons a person can pick by hand.
export const MANUAL_REASONS = ['dnc', 'dead', 'bad_number', 'phone_menu'];
export const SOURCES = { call: 'Call result', manual: 'Added by hand', scrub: 'Scrubber', import: 'Import', registry: 'Registry file', delete: 'Lead deleted', stop: 'Replied STOP' };

// Built in call results that add the lead to the list on their own. Owners can switch "not_interested" on; the rest are always on.
export const AUTO_ACTS = { dnc: 'dnc', bad_number: 'bad_number', phone_menu: 'phone_menu', dead: 'dead' };
export const OPTIONAL_ACTS = { not_interested: 'dead' };
export function reasonForAct(acts, optional = []) {
  if (AUTO_ACTS[acts]) return AUTO_ACTS[acts];
  if (OPTIONAL_ACTS[acts] && optional.includes(acts)) return OPTIONAL_ACTS[acts];
  return null;
}

export const reasonLabel = (r) => REASONS[r]?.label || 'On the list';
export const isLegal = (r) => Boolean(REASONS[r]?.legal);
export const blocksEmail = (r) => Boolean(REASONS[r]?.email);

// The rows written for one lead and reason: one per dedupe key, with `blocks` 1 when that key stops a call or text.
export function rowsFor(lead, reason) {
  const def = REASONS[reason];
  if (!def) return [];
  return dupKeys(lead).map((key) => ({ key, blocks: def.dedupeOnly ? 0 : def.all ? 1 : key.startsWith('p:') ? 1 : 0 }));
}

// A phone number the way keys store it: 10 digits, no leading 1.
export function tenDigits(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : '';
}
export const phoneKey = (v) => (tenDigits(v) ? `p:${tenDigits(v)}` : null);

// ---------- registry files ----------
// The FTC's registry download lists numbers one per line, split as "area code,number" (305,5551234). Other lists (Florida's, a
// vendor's scrub) use plain digits. Either way a line is a number when its digits make 10 (or 11 with a leading 1).
export function numberOfLine(line) {
  const d = String(line).replace(/\D/g, '');
  if (d.length === 10) return d;
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return '';
}
// Read a chunk of a big file without keeping it: `wanted` is the set of numbers we hold, `found` collects the ones that are on the
// list, and what comes back is the unfinished last line to put in front of the next chunk.
export function scanChunk(text, wanted, found) {
  const lines = String(text).split(/\r?\n/);
  const carry = lines.pop();
  for (const ln of lines) { const n = numberOfLine(ln); if (n && wanted.has(n)) found.add(n); }
  return carry;
}
export function scanText(text, wanted) {
  const found = new Set();
  const carry = scanChunk(text, wanted, found);
  const n = numberOfLine(carry);
  if (n && wanted.has(n)) found.add(n);
  return found;
}

// The FTC wants a business that calls to scrub against the registry at least every 31 days.
export const REGISTRY_DAYS = 31;
export function registryAge(at, t = Date.now()) {
  if (!at) return { days: null, stale: true, text: 'Never checked' };
  const days = Math.floor((t - at) / 864e5);
  return { days, stale: days >= REGISTRY_DAYS, text: days === 0 ? 'Checked today' : `Checked ${days} day${days === 1 ? '' : 's'} ago` };
}

// Counts for the page: by reason and by source, plus what the list has kept out.
export function summarize(groups = []) {
  const by = {}, src = {};
  let blocking = 0, legal = 0;
  for (const g of groups) {
    by[g.reason] = (by[g.reason] || 0) + 1;
    src[g.source || 'manual'] = (src[g.source || 'manual'] || 0) + 1;
    if (REASONS[g.reason] && !REASONS[g.reason].dedupeOnly) blocking++;
    if (isLegal(g.reason)) legal++;
  }
  return { total: groups.length, by, src, blocking, legal };
}
