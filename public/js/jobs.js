// Jobs for agents (role team). Owners (role admin) can do everything. Pure: the Worker and the browser both use it, so a menu never
// shows what the server would refuse.
//   Scheduler: the scheduling side and appointment setting. Calls, texts, the pipeline, booking, the team calendar, and moving or
//              handing over anyone's appointment.
//   Appointment setter: calls, texts, the pipeline and booking their own appointments (and picking who runs them).
//   Closer: everything a scheduler and a setter can do, plus the clarity audit and closing (presentation, scan tool, quote, work
//           order, payment link) and the client work after the sale (Clients, My work). Only closers and owners can run a call.
export const JOBS = [
  ['closer', 'Closer', 'Runs the clarity audits and closes. Can also set and schedule appointments, and works with clients after the sale.'],
  ['scheduler', 'Scheduler', 'Books, moves and hands over appointments for the whole team, and sets appointments on the phone.'],
  ['setter', 'Appointment setter', 'Calls and texts leads and books appointments for the closers.'],
];
export const JOB_CAPS = {
  setter: ['dial', 'book'],
  scheduler: ['dial', 'book', 'schedule'],
  closer: ['dial', 'book', 'schedule', 'close', 'deliver'],
};
export const CAP_LABEL = { dial: 'Phone and texts', book: 'Book appointments', schedule: "Manage everyone's appointments", close: 'Clarity audits and closing', deliver: 'Clients and client work' };
export const jobOf = (user) => (user?.role === 'team' ? (JOB_CAPS[user.job] ? user.job : 'setter') : null);
export const jobLabel = (user) => (user?.role === 'admin' ? 'Owner' : (JOBS.find(([k]) => k === jobOf(user)) || [])[1] || 'Agent');
export function can(user, cap) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'team') return false;
  return JOB_CAPS[jobOf(user)].includes(cap);
}
export const canRunCalls = (user) => can(user, 'close');

// Which API paths need which job ability (owners pass everything; clients have their own checks).
const RULES = [
  [/^\/api\/(clients|tasks|work|content|posts|reports|site|citations|scans|autoscan|guides|time|meetings|gbp|reputation|leader|quarterly|tracked-calls|tracking|access|onboarding|sample-client)(\/|$)/, 'deliver'],
  [/^\/api\/leads\/[^/]+\/(quote|work-order|payment-link|deep-scan|convert|pack|pack\/send)$/, 'close'],
];
export function capFor(method, path) {
  for (const [re, cap] of RULES) if (re.test(path)) return cap;
  return null;
}
