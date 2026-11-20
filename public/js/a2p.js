// A2P 10DLC registration packet (pure, shared). Carriers only deliver business texts from US local numbers that are registered:
// a brand (the company), a campaign (what we text and how people agree) and the numbers attached to a Messaging Service.
// Everything below is written from how the Hub really texts (src/sms.js, src/automations.js, the booking page), so the registration
// says what we do and a reviewer who tests it finds the same thing. Modeled on Twilio's Trust Hub A2P registration flow and the
// campaign fields The Campaign Registry asks for. Not legal advice: V's lawyer should read the Terms and Privacy pages.
import { AGENCY_EMAIL } from './agency.js';

export const BUSINESS_PHONE = '(305) 507-3393';
export const SITE = 'https://rightwaygrowth.com';
export const HELP_REPLY = `Rightway Growth: For help email ${AGENCY_EMAIL} or call ${BUSINESS_PHONE}. Msg and data rates may apply. Reply STOP to opt out.`;
const HELP_WORDS = new Set(['help', 'info']);
export const isHelp = (body) => HELP_WORDS.has(String(body || '').trim().toLowerCase().replace(/[^a-z]/g, ''));

// The checkbox wording for the booking page and the website form. Same words everywhere so the registration can quote them.
export const CONSENT_TEXT = 'I agree to receive text messages from Rightway Growth about my appointment and follow ups to my request, at the number I entered. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.';

export const CHECKLIST = [
  ['Legal business name as the IRS has it', 'Rightway Growth LLC, spelled exactly like your EIN letter (CP 575 or 147C).'],
  ['EIN', 'The 9 digit number on that letter. A standard brand needs it; without an EIN Twilio only offers the sole proprietor brand, which is limited.'],
  ['Business address', 'The same address on the EIN letter and the Florida registration.'],
  ['Website', `${SITE} with the business name, a way to contact you, and a link to the Privacy and Terms pages in the footer.`],
  ['Authorized contact', 'A person with a work email and phone who can approve the registration. Use info@rightwaygrowth.com for the email.'],
  ['The Terms and Privacy pages are live', 'Open the Hub address plus /terms.html and /privacy.html. Put the same two pages on rightwaygrowth.com, because reviewers look at your website.'],
  ['The opt in is public', 'The checkbox text below must be on the website form or the booking page, where a reviewer can open it. Take a screenshot of it for the campaign.'],
  ['Logged in to Twilio as info@', 'Create the registration under the company login (see Settings, Accounts and handover), not a personal one.'],
];

// Sample messages written from the real Hub templates. The first text to a person carries the company name and the opt out line.
export function samples() {
  return [
    "Rightway Growth: Hey Ana, it's Vidal. You're all set for Tuesday, November 24 at 2:00 PM EST. I emailed you the Google Meet link. Reply STOP to opt out.",
    "Rightway Growth: Hey Ana, super excited! I emailed you the Google Meet link for today. Let me know if you have it OK. Reply STOP to opt out.",
    "Hey Ana, we missed you today. Want to pick a new time? https://hub.rightwaygrowth.com/book.html",
    "Hey Ana, it's Vidal with Rightway Growth. Thanks for your request for a Google audit of Coastal Roofing. What time works for a quick call?",
    HELP_REPLY,
  ];
}

export function packet(facts = {}) {
  const origin = String(facts.origin || '').replace(/\/$/, '');
  const privacy = `${origin || 'https://YOUR-HUB-ADDRESS'}/privacy.html`;
  const terms = `${origin || 'https://YOUR-HUB-ADDRESS'}/terms.html`;
  return {
    brand: [
      ['Brand type', 'Standard brand with the EIN. (Low volume standard is fine if Twilio offers it for your volume.)'],
      ['Legal name', 'Rightway Growth LLC'],
      ['Business type', 'Limited liability company, for profit, not publicly traded'],
      ['Industry', 'Professional services (marketing)'],
      ['Website', SITE],
      ['Support email', AGENCY_EMAIL],
      ['Support phone', BUSINESS_PHONE],
    ],
    campaign: [
      ['Use case', 'Low Volume Mixed if Twilio shows it for your volume, otherwise Mixed. (Account notifications, customer care and a small amount of marketing follow up.)'],
      ['Campaign description', 'Rightway Growth is a local search marketing agency in Miami and Fort Lauderdale, Florida. We text small business owners who asked for a Google audit or booked a consultation with us: appointment confirmations and reminders with the meeting link, a short reply to their question, and a follow up to rebook if they missed the appointment. We also text existing clients about their account. Messages are sent one to one by our team from our own business numbers. We do not buy or rent phone lists and we do not text anyone who has replied STOP.'],
      ['How people opt in (message flow)', `People opt in on a public web page by ticking an unchecked box next to the text: "${CONSENT_TEXT}" The box is on our appointment booking page (${origin ? `${origin}/book.html` : 'the booking page'}) and on the request form at ${SITE}. The box is optional and is not required to book. People can also text our business number first, which opens the conversation. We keep the consent on the lead record in our system. No texts are sent to anyone who has not done one of these things.`],
      ['Opt out', 'Reply STOP to any message. The person gets one confirmation, is marked do not text in our system and is never texted again. Reply START to opt back in.'],
      ['Help', `Reply HELP to any message. Our system answers with: "${HELP_REPLY}"`],
      ['Message frequency', 'Varies. Usually one to five messages around an appointment, and up to three follow up messages if an appointment is missed.'],
      ['Privacy policy link', privacy],
      ['Terms and conditions link', terms],
      ['Embedded links', 'Yes. Our own booking page and the Google Meet link for the appointment.'],
      ['Embedded phone numbers', 'Yes, our business number.'],
      ['Age gated content, direct lending, affiliate marketing', 'No to all of these.'],
      ['Sending hours', 'Between 8am and 8pm in the recipient\'s time zone, and replies to a person who just texted us.'],
    ],
    samples: samples(),
    keywords: [['Opt in keywords', 'START, YES'], ['Opt out keywords', 'STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT'], ['Help keywords', 'HELP, INFO']],
  };
}

// Where each number stands. numbers: [{number, sid}], services: [{sid, name, numbers: [e164], campaigns: [{status, ...}]}].
// states: registered (campaign verified), pending (campaign submitted), failed, nocampaign (in a service, no campaign), unattached (in no service).
export function numberStates(numbers = [], services = []) {
  return numbers.map((n) => {
    const svc = services.filter((s) => (s.numbers || []).includes(n.number));
    if (!svc.length) return { ...n, state: 'unattached', service: null };
    const camps = svc.flatMap((s) => (s.campaigns || []).map((c) => ({ ...c, service: s.name })));
    const verified = camps.find((c) => /^(VERIFIED|APPROVED)$/i.test(c.status || ''));
    if (verified) return { ...n, state: 'registered', service: verified.service };
    const pending = camps.find((c) => /^(IN_PROGRESS|PENDING|IN_REVIEW)$/i.test(c.status || ''));
    if (pending) return { ...n, state: 'pending', service: pending.service };
    const failed = camps.find((c) => /FAIL/i.test(c.status || ''));
    if (failed) return { ...n, state: 'failed', service: failed.service, reason: failed.error || '' };
    return { ...n, state: 'nocampaign', service: svc[0].name };
  });
}
export const STATE_TEXT = {
  registered: 'Registered. Texts can go.',
  pending: 'Campaign submitted, waiting on review.',
  failed: 'Campaign was rejected. Fix and resubmit.',
  nocampaign: 'In a Messaging Service, but no campaign yet.',
  unattached: 'Not in a Messaging Service yet.',
};
// The next thing to do, in order, from what Twilio shows.
export function nextStep({ brands = [], states = [] } = {}) {
  const okBrand = brands.some((b) => /^(APPROVED|VETTED_VERIFIED|REGISTERED)$/i.test(b.status || ''));
  const pendingBrand = brands.some((b) => /(PENDING|IN_REVIEW|IN_PROGRESS)/i.test(b.status || ''));
  if (!states.length) return 'Add the Twilio keys in Cloudflare so the Hub can read your numbers.';
  if (states.every((s) => s.state === 'registered')) return 'Everything is registered. Switch Automations to Email and text or Text only when you are ready.';
  if (!brands.length) return 'Step 1: register the brand in Twilio (Messaging, Regulatory Compliance, A2P 10DLC). Use the brand details below.';
  if (!okBrand && pendingBrand) return 'The brand is in review. Twilio emails info@ when it is decided. The campaign can be started after that.';
  if (!okBrand) return 'The brand was not approved. Open it in Twilio to read the reason, fix it and resubmit.';
  if (states.some((s) => s.state === 'unattached')) return 'Step 2: create a Messaging Service, add your numbers to its sender pool, then register the campaign with the details below.';
  if (states.some((s) => s.state === 'nocampaign')) return 'Step 3: register the campaign on the Messaging Service with the details below.';
  if (states.some((s) => s.state === 'failed')) return 'The campaign was rejected. Read the reason in Twilio, fix it (usually the opt in screenshot or the Terms page) and resubmit.';
  return 'Waiting on carrier review of the campaign. This usually takes days, not hours.';
}
