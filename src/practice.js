// AI practice calls (Training, Warm up, and the Test power dial): Claude plays a business owner, then coaches the rep.
// FREE by default: the owner is scripted and the feedback is rule based (`public/js/practice.js`). Claude is used only when an owner
// switches on "Use real AI" (body.useAi) and ANTHROPIC_API_KEY is set, which costs a few cents. Agents always get the free mode.
import { json } from './util.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { askClaude } from './assistant.js';
import { personaOf, systemPrompt, cleanTurns, transcriptText, fallbackReply, localCoach, COACH_PROMPT } from '../public/js/practice.js';

const turnsOf = (b) => (Array.isArray(b?.turns) ? b.turns : []).slice(-40).map((t) => ({ role: t?.role === 'lead' ? 'lead' : 'rep', text: String(t?.text || '').slice(0, 600) }));
const leadOf = (b) => ({ business: String(b?.lead?.business || '').slice(0, 80), city: String(b?.lead?.city || '').slice(0, 60) });

const aiOk = (env, user, b) => Boolean(env.ANTHROPIC_API_KEY) && user?.role === 'admin' && b?.useAi === true;

route('GET', '/api/practice/status', async ({ env, user }) => { requireStaff(user); return json({ ai: Boolean(env.ANTHROPIC_API_KEY) && user?.role === 'admin' }); });

route('POST', '/api/practice/turn', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const turns = turnsOf(b);
  const p = personaOf(b.persona);
  if (!aiOk(env, user, b)) return json({ reply: fallbackReply(p, turns), ai: false });
  try {
    const reply = await askClaude(env, { system: systemPrompt(p, leadOf(b)), messages: cleanTurns(turns), maxTokens: 160 });
    return json({ reply: reply.replace(/[–—]/g, ',').replace(/^["']|["']$/g, '') || fallbackReply(p, turns), ai: true });
  } catch { return json({ reply: fallbackReply(p, turns), ai: false }); }
});

route('POST', '/api/practice/coach', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const turns = turnsOf(b);
  if (!aiOk(env, user, b) || !turns.some((t) => t.role === 'rep')) return json({ feedback: localCoach(turns), ai: false });
  try {
    const feedback = await askClaude(env, { system: COACH_PROMPT, messages: [{ role: 'user', content: `Owner persona: ${personaOf(b.persona).name}, ${personaOf(b.persona).role}.\n\n${transcriptText(turns)}` }], maxTokens: 450 });
    return json({ feedback: feedback.replace(/[–—]/g, ','), ai: true });
  } catch { return json({ feedback: localCoach(turns), ai: false }); }
});
