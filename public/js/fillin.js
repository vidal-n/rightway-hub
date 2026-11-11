// Pure logic for the Pipeline "Fill in missing info" panel (shared by the page and tests).
import { PRICES } from './pricing.js';

const OPEN = (l) => !['won', 'lost', 'dnc'].includes(l.stage) && !l.dnc;
const isFL = (l) => !l.state || /^(fl|florida)$/i.test(String(l.state).trim());
// A scrub already read the website and the registry. If it found nothing, the field is still empty but nothing is missing that a scrub can fix.
const checked = (l) => Boolean(l.scrubbed_at);

// What each item needs to be possible, and who lacks it. Pure, so the counts match what runs.
export function fillItems(leads, { cleanName, twilio, owner }) {
  const open = leads.filter(OPEN);
  const site = (l) => Boolean(l.website);
  const items = [
    { id: 'name', title: 'Business names', free: true, group: 'site',
      where: 'Our own clean up rules: drops SEO tails, LLC endings and ALL CAPS. No outside calls.',
      miss: (l) => Boolean(l.business) && !l.business_raw && cleanName(l.business, { city: l.city, state: l.state }).changed },
    { id: 'owner', title: 'Owner name', free: true, group: 'site',
      where: 'Their website contact and about pages, and the Florida business registry (Sunbiz). Other states get a search link only.',
      miss: (l) => !l.owner_name && !checked(l) && (site(l) || isFL(l)) },
    { id: 'email', title: 'Email address', free: true, group: 'site',
      where: 'Their website home, contact and about pages (mailto links and text). Then checks the email domain takes mail.',
      miss: (l) => !l.email && !checked(l) && site(l) },
    { id: 'social', title: 'Social pages', free: true, group: 'site',
      where: 'Facebook, Instagram, LinkedIn, YouTube, TikTok, X, Yelp links found on their website.',
      miss: (l) => !l.has_socials && !checked(l) && site(l) },
    { id: 'phone', title: 'Phone type (mobile or landline)', free: false, group: 'phone', usd: PRICES.phone_lookup.usd, off: !twilio ? 'Needs Twilio connected.' : '',
      where: 'Twilio Lookup, one check per number. Also reads their website once, free.',
      miss: (l) => !l.phone_type && Boolean(l.phone) && (!checked(l) || l.scrub_lookup === 1) },
  ];
  if (owner) items.unshift({ id: 'tz', title: 'Time zone', free: true, group: 'tz',
    where: 'Their state, ZIP and address already in the Hub. No outside calls. Runs for every lead, not just this view.',
    miss: (l) => !l.tz_known });
  return items.map((it) => ({ ...it, leads: open.filter(it.miss) }));
}

// Which leads get scrubbed for the ticked items, and what the phone checks cost.
export function fillPlan(items, ticked) {
  const on = items.filter((i) => ticked.has(i.id));
  const scrub = new Map();
  for (const i of on) if (i.group !== 'tz') for (const l of i.leads) scrub.set(l.id, l);
  const phone = on.find((i) => i.id === 'phone');
  const lookups = phone ? phone.leads.length : 0;
  return { leads: [...scrub.values()], tz: on.some((i) => i.id === 'tz'), lookup: Boolean(phone), lookups, usd: lookups * PRICES.phone_lookup.usd };
}
