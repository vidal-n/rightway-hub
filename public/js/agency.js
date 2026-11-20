// The one company email (pure, shared by the Worker and the browser). V's rule (Nov 2026): every email the Hub sends goes out
// From this address, every vendor account is opened under it, and it is the login for client and managed accounts.
// Replies still go to the rep (Reply-To). Resend only sends from a domain verified in Resend, so info@ must be on rightwaygrowth.com.
export const AGENCY_EMAIL = 'info@rightwaygrowth.com';
export const AGENCY_NAME = 'Rightway Growth';
export const AGENCY_FROM = `${AGENCY_NAME} <${AGENCY_EMAIL}>`;
// "Vidal (Rightway Growth) <info@...>": the person's name in front, always the company address.
export function fromLine(name) {
  const n = String(name || '').replace(/[<>",]/g, '').trim();
  return `${n ? `${n} (${AGENCY_NAME})` : AGENCY_NAME} <${AGENCY_EMAIL}>`;
}
