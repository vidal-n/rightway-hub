// Which scope a client starts with. A leaf module (no database, no routes) so crm.js, billing.js and hub.js can all import it.
import { cleanScope } from '../public/js/scope.js';
import { servicesFor, quoteFor, scopeOfQuote } from '../public/js/leadintel.js';

// The scope a client starts with when nobody has researched or quoted them (added by hand): the core services plus pages, links and competitor tracking.
export const defaultScope = (lead = {}, intel = null) => cleanScope(servicesFor(lead, intel).map((x) => ({ id: x.id, qty: x.qty })));

// The scope for a won lead: what was saved on the quote, else what the research recommends.
export function scopeFromLead(lead) {
  let intel = null;
  try { intel = lead.intel ? JSON.parse(lead.intel) : null; } catch { intel = null; }
  return cleanScope(scopeOfQuote(quoteFor(lead, intel, lead.quote)));
}
