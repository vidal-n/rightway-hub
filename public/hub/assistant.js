// Ask Claude: a side panel that stays open while you work on a client or a task. Claude gets that client's details
// (and the task guide when opened from a task), so it can draft posts, review replies, page sections and walk you through steps.
import { $, esc, api, copy, icon } from './core.js';

const chats = new Map(); // conversation per client and task, kept while the Hub is open
let panel = null;
let ctx = null;

const SUGGEST = {
  post: ['Write this month\'s Google post from their services', 'Give me 4 post ideas for this month'],
  replies: ['Draft a reply to their newest review', 'How do I reply to a bad review the right way?'],
  page: ['Outline a service page for their main service and city', 'What should this page include so it is not thin?'],
  content: ['Outline an article for their main keyword', 'Write an intro paragraph I can edit'],
  link: ['Where can this business get local links?', 'Write a short business description for directories'],
  onpage: ['What is the most important fix on their site right now?', 'Write a better title and meta description for the home page'],
  photos: ['What photos should we ask the client for?'],
  qa: ['Write 5 common customer questions with answers we can use'],
  report: ['Summarize this month for the client in 4 short lines'],
  meeting: ['Make an agenda for this month\'s meeting'],
  setup: ['What do we need from the client to finish setup?'],
};
const GENERAL = ['What should I work on first for this client?', 'Write a Google Business Profile description (750 characters max)', 'Draft a check-in text to the client'];

const md = (s) => esc(s)
  .replace(/^### (.*)$/gm, '<b>$1</b>').replace(/^## (.*)$/gm, '<b>$1</b>').replace(/^# (.*)$/gm, '<b>$1</b>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\n/g, '<br>');

function key() { return `${ctx.clientId || 'none'}|${ctx.taskId || ''}`; }

export function openAssistant(opts = {}) {
  ctx = { clientId: opts.clientId || null, taskId: opts.taskId || null, name: opts.name || '', task: opts.task || null };
  if (!chats.has(key())) chats.set(key(), []);
  if (!panel) {
    panel = document.createElement('aside');
    panel.className = 'ai-panel';
    panel.setAttribute('aria-label', 'Ask Claude');
    document.body.appendChild(panel);
  }
  panel.hidden = false;
  draw();
  setTimeout(() => $('#ai-q', panel)?.focus(), 50);
}

function draw() {
  const list = chats.get(key());
  const tips = [...(ctx.task ? SUGGEST[ctx.task.kind] || [] : []), ...GENERAL].slice(0, 4);
  panel.innerHTML = `
    <div class="ai-head"><div><b>Ask Claude</b><div class="small muted">${esc(ctx.name || 'No client picked')}${ctx.task ? ` · ${esc(ctx.task.title)}` : ''}</div></div>
      <div class="row" style="gap:6px">${list.length ? '<button class="btn btn-ghost btn-sm" id="ai-new">New chat</button>' : ''}<button class="icon-btn" id="ai-x" aria-label="Close">${icon.close}</button></div></div>
    <div class="ai-log" id="ai-log">
      ${list.length ? list.map((m, i) => `<div class="ai-msg ${m.role}">${m.role === 'assistant' ? `${md(m.content)}<div class="ai-tools"><button class="btn btn-ghost btn-sm" data-copy="${i}">Copy</button></div>` : esc(m.content).replace(/\n/g, '<br>')}</div>`).join('')
        : `<p class="small muted">Claude knows this client's plan, services, cities, keywords, this month's tasks, the latest scans, the website check and recent reviews${ctx.task ? ', plus the guide for this task' : ''}. It never makes up facts about the business.</p>
           <div class="ai-tips">${tips.map((t) => `<button class="btn btn-ghost btn-sm" data-tip="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <div class="ai-msg assistant ai-wait" id="ai-wait" hidden><span class="spin"></span> Thinking</div>
    </div>
    <form class="ai-form" id="ai-form"><textarea id="ai-q" rows="2" placeholder="Ask anything about this client's work" aria-label="Your question"></textarea><button class="btn btn-primary" type="submit">Send</button></form>
    <p class="err-text small" id="ai-err" role="alert"></p>`;
  const log = $('#ai-log', panel);
  log.scrollTop = log.scrollHeight;
  $('#ai-x', panel).onclick = () => { panel.hidden = true; };
  $('#ai-new', panel)?.addEventListener('click', () => { chats.set(key(), []); draw(); });
  panel.querySelectorAll('[data-tip]').forEach((b) => { b.onclick = () => send(b.dataset.tip); });
  panel.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => copy(list[Number(b.dataset.copy)].content, 'Copied'); });
  const q = $('#ai-q', panel);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ai-form', panel).requestSubmit(); } });
  $('#ai-form', panel).onsubmit = (e) => { e.preventDefault(); send(q.value); };
}

async function send(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const k = key();
  const list = chats.get(k);
  list.push({ role: 'user', content: t });
  draw();
  $('#ai-wait', panel).hidden = false;
  $('#ai-log', panel).scrollTop = 1e9;
  const btn = panel.querySelector('#ai-form button');
  btn.disabled = true;
  try {
    const r = await api('/api/assistant', { method: 'POST', body: { clientId: ctx.clientId, taskId: ctx.taskId, messages: list } });
    list.push({ role: 'assistant', content: r.reply || '(no answer)' });
    if (key() === k) draw();
  } catch (err) {
    list.pop();
    if (key() === k) { draw(); $('#ai-q', panel).value = t; $('#ai-err', panel).textContent = err.message; }
  }
}
