// Workspaces (Nov 2026 overhaul, modeled on the workspace switchers of Linear, Slack and HubSpot, and on GoHighLevel's breadth without its
// 20 item side menu): seven places plus two utility ones. Each has its own colour (CSS --ws-<key>) and a tab strip of its pages.
// Tab: [label, href, need ('admin' or a job ability), badge key]. Pages keep their own routes; this only groups them.
export const WORKSPACES = [
  ['home', 'Home', 'home', [['Today', '#/'], ['Calendar', '#/calendar'], ['Notifications', '#/notifications', '', 'alerts'], ['Training', '#/training']]],
  ['sell', 'Sell', 'phone', [['Pipeline', '#/pipeline', '', 'pipeline'], ['Dialer', '#/phone'], ['Lead database', '#/pipeline/database'], ['Script tests', '#/pipeline/scripts'], ['Do not call list', '#/pipeline/suppression'], ['Lead finder', '#/finder', 'admin'], ['Agents', '#/agents'], ['Scan tool', '/scan.html', 'close']]],
  ['inbox', 'Inbox', 'msg', [['All conversations', '#/conversations', '', 'inbox'], ['Texts', '#/phone/texts', '', 'texts'], ['Calls', '#/phone/history', '', 'calls'], ['Meetings', '#/phone/meet'], ['Slack', '#/slack', '', 'slack'], ['Mail', '#/mail']]],
  ['clients', 'Clients', 'users', [['All clients', '#/clients', 'deliver'], ['Client view', '#/clients/view', 'close']]],
  ['deliver', 'Deliver', 'check', [['My work', '#/work', 'deliver', 'work'], ['Posts to publish', '#/work/posts', 'deliver'], ['Schedule', '#/work/schedule'], ['Hours', '#/work/hours', 'deliver'], ['Guides', '#/work/guides', 'deliver']]],
  ['insights', 'Insights', 'chart', [['Call insights', '#/pipeline/insights'], ['Script tests', '#/pipeline/scripts'], ['Call analytics', '#/agents/analytics'], ['Master sheet', '#/agents/sheet']]],
  ['money', 'Money', 'money', [['Payments', '#/payments', 'admin'], ['Budget', '#/settings/budget', 'admin']]],
  ['automate', 'Automate', 'spark', [['Workflows', '#/automations/workflows', 'admin'], ['Booking reminders', '#/automations', 'admin'], ['Google', '#/google'], ['Vault', '#/vault', 'admin']]],
  ['settings', 'Settings', 'cog', [['Settings', '#/settings'], ['Agents and roles', '#/settings/team', 'admin'], ['Files', '#/settings/files', 'admin'], ['Bug reports', '#/settings/bugs', 'admin']]],
];
// Routes whose workspace is not obvious from the tab list (longest prefix wins, then these).
const WS_EXTRA = [['#/client/', 'clients'], ['#/clientview', 'clients'], ['#/dialer', 'sell'], ['#/inbox', 'inbox'], ['#/phone/out', 'inbox'], ['#/phone/calls', 'inbox'],
  ['#/phone/voicemail', 'inbox'], ['#/phone/recordings', 'sell'], ['#/phone/line', 'sell'], ['#/phone/setup', 'sell'], ['#/phone/agents', 'sell'], ['#/phone/live', 'sell'],
  ['#/google/mail', 'inbox'], ['#/alerts', 'home'], ['#/present', 'sell'], ['#/files', 'settings']];
// `can` comes from public/js/jobs.js (passed in so this file stays free of imports).
const okFor = (user, need, can) => !need || (need === 'admin' ? user?.role === 'admin' : need[0] === '!' ? !can(user, need.slice(1)) : can(user, need));
export function wsTabs(user, key, can) {
  const w = WORKSPACES.find((x) => x[0] === key);
  return w ? w[3].filter((t) => okFor(user, t[2], can)) : [];
}
export const wsList = (user, can) => WORKSPACES.filter((w) => wsTabs(user, w[0], can).length);
// The workspace and tab for a hash (pure apart from the table).
export function wsFor(hash = '#/') {
  const h = (hash || '#/').split('?')[0];
  if (h === '#/' || h === '' || h === '#') return { ws: 'home', tab: '#/' };
  let best = null;
  for (const w of WORKSPACES) for (const t of w[3]) {
    const href = t[1];
    if (href === '#/') continue;
    if (h === href || h.startsWith(`${href}/`)) { if (!best || href.length > best.tab.length) best = { ws: w[0], tab: href }; }
  }
  // A lead or client id after a list route (#/pipeline/<id>) still belongs to that list.
  const extra = WS_EXTRA.filter(([p]) => h.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
  if (extra && (!best || extra[0].length > best.tab.length)) return { ws: extra[1], tab: best?.ws === extra[1] ? best.tab : '' };
  return best || { ws: 'home', tab: '' };
}
