// Slack message text to safe HTML, shared by the team's Slack page and the client Messages page.
import { esc } from './core.js';

export const EMOJI = { '+1': '👍', thumbsup: '👍', '-1': '👎', heart: '❤️', smile: '😄', slightly_smiling_face: '🙂', joy: '😂', laughing: '😆', grin: '😁', fire: '🔥', tada: '🎉',
  white_check_mark: '✅', heavy_check_mark: '✔️', eyes: '👀', pray: '🙏', raised_hands: '🙌', clap: '👏', '100': '💯', rocket: '🚀', wave: '👋', ok_hand: '👌', thinking_face: '🤔',
  sob: '😭', muscle: '💪', star: '⭐', money_with_wings: '💸', moneybag: '💰', phone: '📞', calendar: '📅', point_up: '☝️', sweat_smile: '😅', wink: '😉', x: '❌', warning: '⚠️' };

// Slack text to safe HTML: escape everything, then add mentions, links and simple formatting.
export function slackHtml(text, people = {}) {
  const parts = [];
  let i = 0;
  const raw = String(text || '');
  for (const m of raw.matchAll(/<([^>\n]{1,500})>/g)) {
    parts.push({ t: raw.slice(i, m.index) });
    parts.push({ tok: m[1] });
    i = m.index + m[0].length;
  }
  parts.push({ t: raw.slice(i) });
  const fmtText = (s) => esc(s)
    .replace(/```([\s\S]+?)```/g, (_, c) => `<pre>${c}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<b>$2</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?]|$)/g, '$1<s>$2</s>')
    .replace(/:([a-z0-9_+-]{1,40}):/g, (all, n) => (EMOJI[n] ? EMOJI[n] : all))
    .replace(/\n/g, '<br>');
  return parts.map((p) => {
    if (p.t != null) return fmtText(p.t);
    const [target, label] = p.tok.split('|');
    if (/^@[UW][A-Z0-9]+$/.test(target)) return `<span class="sl-mention">@${esc(people[target.slice(1)]?.name || label || 'someone')}</span>`;
    if (/^#[CG][A-Z0-9]+$/.test(target)) return `<span class="sl-mention">#${esc(label || 'channel')}</span>`;
    if (/^!(here|channel|everyone)/.test(target)) return `<span class="sl-mention">@${esc(target.slice(1).split('^')[0])}</span>`;
    if (/^(https?:\/\/|mailto:)/i.test(target)) return `<a href="${esc(target)}" target="_blank" rel="noopener">${esc(label || target)}</a>`;
    return esc(label || target);
  }).join('');
}

