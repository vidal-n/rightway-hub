// AI practice calls: the bot plays a business owner, the rep practices the cold call. Pure and shared by the Worker, the Hub and tests.
// Without an Anthropic key the Worker uses `fallbackReply` (simple scripted owner) and `localCoach` (rule based feedback).
export const PERSONAS = [
  { id: 'friendly', name: 'Mike', role: 'plumbing company owner', level: 'Easy', mood: 'friendly but busy, standing on a job site', open: 'Hello?',
    objections: ["I'm on a job right now. What's this about?", 'We get most of our work from referrals, honestly.', 'How much does something like that cost?'],
    yes: "Alright, fine. Send me the link and I'll hop on." },
  { id: 'skeptical', name: 'Dana', role: 'roofing company owner', level: 'Medium', mood: 'skeptical and tired of marketing calls', open: 'Yeah?',
    objections: ['Is this a sales call?', 'I already got burned by an SEO company. Never again.', 'Just email me something.', 'Not interested.'],
    yes: 'Fine. Thirty minutes, that is it.' },
  { id: 'agency', name: 'Carlos', role: 'HVAC company owner', level: 'Medium', mood: 'polite but guarded, already works with a marketing company', open: 'This is Carlos.',
    objections: ['We already have a company that does our marketing.', "How'd you get my number?", 'Are you with Google?'],
    yes: "Okay, I'll look at it. It's free, right? Send it over." },
  { id: 'gatekeeper', name: 'Jess', role: 'office manager at a med spa', level: 'Hard', mood: 'a protective gatekeeper who screens every call', open: 'Thanks for calling, this is Jess.',
    objections: ["He's not available. What is this regarding?", 'Is he expecting your call?', 'I can take a message.', "Send an email to the info address and we'll look at it."],
    yes: 'I can put you down for that time. What is your number?' },
  { id: 'busy', name: 'Tony', role: 'electrician', level: 'Hard', mood: 'rushed and a little rude', open: 'Yeah, who is this?',
    objections: ["I'm busy right now.", 'Make it quick.', "We're too small for this.", 'Call me in a few months.'],
    yes: "Ugh. Okay. Send the invite, I'll see if I'm free." },
  { id: 'voicemail', name: 'Voicemail', role: 'voicemail greeting', level: 'Easy', mood: 'an automated voicemail greeting that records a message', open: "You've reached the business. We can't take your call right now. Leave a message after the tone.",
    objections: ['(beep) Your message is being recorded.', 'Your message is being recorded. Press pound when you are done.'],
    yes: 'Your message has been saved. Goodbye.' },
];
export const personaOf = (id) => PERSONAS.find((p) => p.id === id) || PERSONAS[0];

export function systemPrompt(persona, lead = {}) {
  const p = personaOf(persona?.id || persona);
  return `You are playing ${p.name}, ${p.role}${lead.business ? ` at ${lead.business}` : ''} in ${lead.city || 'South Florida'}. This is a practice cold call for a sales rep from RightWay Growth, a local SEO agency in Miami and Fort Lauderdale. The rep is trying to book a short screen share where they walk you through a free competitor analysis and a Google Game Plan for your business. Your mood: ${p.mood}. Difficulty: ${p.level}.

Rules:
- Talk like a real person on the phone: one or two short sentences, no stage directions, no lists, no quotation marks.
- Stay in character the whole time. Never say you are an AI or that this is practice. Never coach the rep.
- Do not make it easy. Raise these objections one at a time, only when the conversation calls for them: ${p.objections.map((o) => `"${o}"`).join('; ')}.
- Soften only when the rep is calm, specific, asks a good question or handles your objection well.
- Agree to a time only after the rep clearly offers two times to choose from and has earned it. Then say something like: "${p.yes}"
- If the rep is pushy, vague or makes things up, get shorter and end the call.
- When the call is over, give a short sign off.
- Never use dashes.`;
}

export const COACH_PROMPT = `You are a sales coach for RightWay Growth cold callers. Below is a practice call transcript. The rep was trying to book a screen share (a free competitor analysis and a Google Game Plan) with a business owner.
Give: a score from 1 to 10, what worked (at most 2 short lines), what to fix (at most 3 short lines), and one better line to say, written as a quote. Judge the opener, the pattern interrupt, tone, how they handled the objection, and whether they asked for the booking with two times.
Plain text, short, no markdown headers, no dashes.`;

// Turns are { role: 'rep' | 'lead', text }. The rep is the "user" and the bot is the "assistant". The call starts with a connect note so the bot speaks first.
export function cleanTurns(list) {
  const out = [{ role: 'user', content: '[The phone rings and you pick up. Say your first line.]' }];
  for (const t of (Array.isArray(list) ? list : []).slice(-40)) {
    const role = t?.role === 'lead' ? 'assistant' : 'user';
    const content = String(t?.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!content) continue;
    if (out[out.length - 1].role === role) out[out.length - 1].content += ` ${content}`;
    else out.push({ role, content });
  }
  return out;
}
export const transcriptText = (turns) => (Array.isArray(turns) ? turns : []).filter((t) => t?.text).map((t) => `${t.role === 'rep' ? 'REP' : 'OWNER'}: ${String(t.text).slice(0, 600)}`).join('\n');

const TIME = /\b(\d{1,2}(:\d\d)?\s?(am|pm)|noon|tomorrow|today|monday|tuesday|wednesday|thursday|friday|morning|afternoon)\b/i;
export const asksTimes = (t) => TIME.test(t) && /\bor\b/i.test(t);

export function fallbackReply(persona, turns) {
  const p = personaOf(persona?.id || persona);
  const rep = (turns || []).filter((t) => t.role === 'rep');
  if (!rep.length) return p.open;
  const last = rep[rep.length - 1].text || '';
  if (/\b(bye|goodbye|take care|have a good)\b/i.test(last)) return 'Alright, take care.';
  if (asksTimes(last) && rep.length >= 3) return p.yes;
  if (rep.length > p.objections.length + 1) return p.yes;
  return p.objections[(rep.length - 1) % p.objections.length];
}

// Rule based feedback for when there is no AI key.
export function localCoach(turns) {
  const rep = (turns || []).filter((t) => t.role === 'rep').map((t) => String(t.text || ''));
  if (!rep.length) return 'You did not say anything yet. Start the call and try again.';
  const all = rep.join(' ');
  let score = 4; const good = []; const fix = [];
  if (rep[0].split(/\s+/).length <= 25) { score++; good.push('Short opener. Good.'); } else fix.push('Your opener ran long. Keep the first line under one breath.');
  if (/\bfree\b/i.test(all)) { score++; good.push('You said it is free.'); } else fix.push('Say it is free early. It lowers the guard.');
  if (/\b(competitor|google|game ?plan|analysis)\b/i.test(all)) { score++; good.push('You named what they get.'); } else fix.push('Name what they get: a free competitor analysis and a Google Game Plan.');
  if (rep.some(asksTimes)) { score += 2; good.push('You offered two times.'); } else fix.push('Ask for the booking with two times, like "12pm or 4pm?".');
  if (rep.length >= 3) { score++; good.push('You kept the conversation going.'); } else fix.push('Do not stop after one answer. Two rebuttals before you move on.');
  if (/\b(trust me|you need to|you have to|you should)\b/i.test(all)) { score--; fix.push('Cut the pushy phrases like "you need to".'); }
  score = Math.max(1, Math.min(10, score));
  return `Score: ${score} of 10 (basic feedback, the AI coach needs an Anthropic key).\n\nWhat worked: ${good.slice(0, 2).join(' ') || 'You picked up the phone and tried. That counts.'}\n\nFix: ${fix.slice(0, 3).join(' ') || 'Nothing big. Run it again with a harder owner.'}\n\nTry saying: "Totally fair. Does tomorrow at 12pm or 4pm work better for you?"`;
}
