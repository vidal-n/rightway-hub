// Pipeline filters. Pure so the tests can run it in Node.
export function filterLeads(leads, p) {
  const f = p.f || {};
  const q = (f.q || '').toLowerCase().trim();
  const inc = (v, want) => !want || String(v || '').toLowerCase().includes(String(want).toLowerCase().trim());
  return leads.filter((l) => {
    if (p.tz && (p.tz === '?' ? l.tz_short : l.tz_short !== p.tz)) return false;
    if (q && ![l.business, l.contact_name, l.phone, l.email, l.city, l.industry, l.category, l.zip, l.tags].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (f.grades?.length && !f.grades.includes(l.grade)) return false;
    if (f.state && l.state !== f.state) return false;
    if (!inc(l.city, f.city) || !inc(`${l.industry || ''} ${l.category || ''}`, f.industry) || !inc(l.tags, f.tag)) return false;
    if (f.source && l.source !== f.source) return false;
    if (f.stage && l.stage !== f.stage) return false;
    if (f.site === 'yes' && !l.website) return false;
    if (f.site === 'no' && l.website) return false;
    if (f.researched === 'yes' && !l.researched) return false;
    if (f.researched === 'no' && l.researched) return false;
    if (f.minReviews !== '' && f.minReviews != null && (l.reviews ?? -1) < Number(f.minReviews)) return false;
    if (f.maxReviews !== '' && f.maxReviews != null && (l.reviews ?? 1e9) > Number(f.maxReviews)) return false;
    if (f.maxRating !== '' && f.maxRating != null && (l.rating ?? 0) > Number(f.maxRating)) return false;
    if (f.minScore && (l.score || 0) < Number(f.minScore)) return false;
    if (f.notTop3 && l.map_rank != null && l.map_rank <= 3) return false;
    if (f.notTop10 && l.map_rank != null && l.map_rank <= 10) return false;
    if (f.callable && !l.callable_now) return false;
    // Scrubbed data: phone line type, email, owner name, data score.
    if (f.phoneType && (f.phoneType === 'unknown' ? l.phone_type : l.phone_type !== f.phoneType)) return false;
    const goodEmail = Boolean(l.email) && !['bad', 'no_mail_server'].includes(l.email_status);
    if (f.email === 'yes' && !goodEmail) return false;
    if (f.email === 'person' && (!goodEmail || l.email_status === 'role')) return false;
    if (f.email === 'no' && goodEmail) return false;
    if (f.owner === 'yes' && !(l.owner_name || l.contact_name)) return false;
    if (f.owner === 'no' && (l.owner_name || l.contact_name)) return false;
    if (f.scrubbed === 'yes' && !l.scrubbed_at) return false;
    if (f.scrubbed === 'no' && l.scrubbed_at) return false;
    if (f.minData && (l.data_score || 0) < Number(f.minData)) return false;
    return true;
  });
}

