// AI practice calls (Training, Warm up, and the Test power dial): Claude plays a business owner, then coaches the rep.
// Needs ANTHROPIC_API_KEY for the real thing. Without it the owner is scripted and the feedback is rule based (`public/js/practice.js`).
import { json } from './util.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { askClaude } from './assistant.js';
import { personaOf, systemPrompt, cleanTurns, transcriptText, fallbackReply, localCoach, COACH_PROMPT } from '../public/js/practice.js';

const turnsOf = (b) => (Array.isArray(b?.turns) ? b.turns : []).slice(-40).map((t) => ({ role: t?.role === 'lead' ? 'lead' : 'rep', text: String(t?.text || '').slice(0, 600) }));
const leadOf = (b) => ({ business: String(b?.lead?.business || '').slice(0, 80), city: String(b?.lead?.city || '').slice(0, 60) });

route('GET', '/api/practice/status', async ({ env, user }) => { requireStaff(user); return json({ ai: Boolean(env.ANTHROPIC_API_KEY) }); });

route('POST', '/api/practice/turn', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const turns = turnsOf(b);
  const p = personaOf(b.persona);
  if (!env.ANTHROPIC_API_KEY) return json({ reply: fallbackReply(p, turns), ai: false });
  try {
    const reply = await askClaude(env, { system: systemPrompt(p, leadOf(b)), messages: cleanTurns(turns), maxTokens: 160 });
    return json({ reply: reply.replace(/[–—]/g, ',').replace(/^["']|["']$/g, '') || fallbackReply(p, turns), ai: true });
  } catch { return json({ reply: fallbackReply(p, turns), ai: false }); }
});

route('POST', '/api/practice/coach', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const turns = turnsOf(b);
  if (!env.ANTHROPIC_API_KEY || !turns.some((t) => t.role === 'rep')) return json({ feedback: localCoach(turns), ai: false });
  try {
    const feedback = await askClaude(env, { system: COACH_PROMPT, messages: [{ role: 'user', content: `Owner persona: ${personaOf(b.persona).name}, ${personaOf(b.persona).role}.\n\n${transcriptText(turns)}` }], maxTokens: 450 });
    return json({ feedback: feedback.replace(/[–—]/g, ','), ai: true });
  } catch { return json({ feedback: localCoach(turns), ai: false }); }
});
