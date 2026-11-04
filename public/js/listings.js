// The prospect's real listing check, in words an owner understands. Pure; used by call prep and the presentation.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LISTING_LABEL = {
  mismatch: ['bad', 'Wrong info'], missing: ['warn', 'Not listed'], found: ['gray', 'Listed, check details'], match: ['good', 'Matches'], error: ['gray', 'Could not check'],
};
const ORDER = { mismatch: 0, missing: 1, found: 2, match: 3, error: 4 };

export function parseListings(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// One line the rep can say, from the counts.
export function listingsLine(L) {
  if (!L?.results?.length) return '';
  const c = L.counts || {};
  const bad = (c.mismatch || 0);
  const miss = (c.missing || 0);
  const ok = (c.match || 0);
  return `I checked ${L.results.length} directories Google uses to double check you. ${bad ? `${bad} show${bad === 1 ? 's' : ''} the wrong information` : 'None show wrong information'}, ${miss} ${miss === 1 ? "doesn't" : "don't"} list you at all, and ${ok} match${ok === 1 ? 'es' : ''}.`;
}

export function sortedListings(L) {
  return [...(L?.results || [])].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
}

export function listingsTable(L, { max = 15, links = true } = {}) {
  const rows = sortedListings(L).slice(0, max);
  if (!rows.length) return '';
  return `<table class="lst"><thead><tr><th>Directory</th><th>What Google finds</th></tr></thead><tbody>${rows.map((r) => {
    const [cls, label] = LISTING_LABEL[r.status] || LISTING_LABEL.error;
    const note = r.notes?.length ? r.notes.join('. ') : r.status === 'missing' ? 'No listing found' : r.status === 'match' ? 'Name and details match' : r.status === 'found' ? 'Listed, details not shown in the preview' : r.error || '';
    return `<tr class="lst-${esc(r.status)}"><td>${links && r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td><td><span class="lst-tag ${cls}">${esc(label)}</span> ${esc(note)}</td></tr>`;
  }).join('')}</tbody></table>`;
}
