// Post captions for Google Business Profile, Facebook, and Instagram.
// With ANTHROPIC_API_KEY set, Claude looks at the photo and writes captions; otherwise templates fill in.
// Rules baked in: real services and cities, natural keywords (no stuffing), no phone numbers or links in Google posts,
// a few relevant hashtags (not 30), no claims the business didn't make.

import { logClaude } from './costs.js';

const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const list = (s) => String(s || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
const tag = (s) => '#' + String(s).replace(/&/g, 'and').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');

export function clientContext(c) {
  return {
    name: c.name,
    category: c.category || '',
    services: list(c.services),
    cities: list(c.cities),
    keywords: list(c.keywords),
    voice: c.brand_voice || 'friendly, local, confident, no hype',
  };
}

export function templateCaptions(client, note = '') {
  const c = clientContext(client);
  const service = c.services[0] || c.category || 'our work';
  const city = c.cities[0] || '';
  const where = city ? ` in ${city}` : '';
  const detail = note ? `${note.trim().replace(/\.$/, '')}. ` : '';
  const kw = [...new Set([service, ...c.keywords.slice(0, 2), city && `${service} ${city}`].filter(Boolean))];
  const hashtags = [...new Set([tag(service), city && tag(city), city && tag(`${city} ${service}`), tag(c.name)].filter(Boolean))].slice(0, 5);
  return {
    google: `${detail}Another ${service.toLowerCase()} project done right${where}. ${c.name} handles every job with care, clear pricing, and cleanup when we're done. Need ${service.toLowerCase()}${where}? Tap the button below to get in touch.`,
    facebook: `${detail}Proud of this one! ${c.name} is here for ${service.toLowerCase()}${where}. Questions? Send us a message anytime. ${hashtags.slice(0, 2).join(' ')}`,
    instagram: `${detail}Fresh work from the ${c.name} team${where}. ${service} done the right way.\n\n${hashtags.join(' ')}`,
    hashtags,
    keywords: kw,
    alt_text: note ? note.slice(0, 120) : `${service} by ${c.name}${where}`,
    ai: false,
  };
}

export function buildPrompt(client, note) {
  const c = clientContext(client);
  return `You write social and Google Business Profile posts for a local business. Use the photo (if any) and the note.

Business: ${c.name}
Category: ${c.category || 'not given'}
Services: ${c.services.join(', ') || 'not given'}
Cities served: ${c.cities.join(', ') || 'not given'}
Target keywords: ${c.keywords.join(', ') || 'not given'}
Brand voice: ${c.voice}
Note from the business: ${note || '(none)'}

Write:
1. "google": a Google Business Profile post, 80 to 160 words. Mention the specific service shown and one city naturally, once each. Describe what is in the photo concretely. End with a call to action that points to the post's button. No phone numbers, no URLs, no hashtags, no emojis, no prices or promises the note doesn't state.
2. "facebook": 40 to 90 words, conversational, 1 or 2 relevant hashtags at the end.
3. "instagram": 30 to 70 words, then a blank line, then 4 to 8 specific hashtags (service, city, neighborhood, niche). No generic tags like #love or #instagood.
4. "hashtags": the Instagram hashtags as an array.
5. "keywords": 3 to 6 search phrases the post naturally covers, as an array.
6. "alt_text": one plain sentence describing the photo for accessibility.

Rules: never invent facts, awards, years in business, reviews, or offers. Never stuff keywords. Use plain words. No em dashes.
Reply with only a JSON object with those six keys.`;
}

export function parseCaptionJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in the reply');
  const j = JSON.parse(m[0]);
  const str = (v, max) => String(v || '').replace(/[–—]/g, ', ').slice(0, max);
  return {
    google: str(j.google, 1500),
    facebook: str(j.facebook, 2000),
    instagram: str(j.instagram, 2200),
    hashtags: (Array.isArray(j.hashtags) ? j.hashtags : []).map((h) => String(h).trim()).filter(Boolean).slice(0, 10),
    keywords: (Array.isArray(j.keywords) ? j.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 8),
    alt_text: str(j.alt_text, 200),
    ai: true,
  };
}

// image: { base64, mediaType } or null
export async function generateCaptions(env, client, note, image, fetchImpl = fetch) {
  if (!env.ANTHROPIC_API_KEY) return templateCaptions(client, note);
  const content = [];
  if (image?.base64 && /^image\/(jpeg|png|webp|gif)$/.test(image.mediaType || '')) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  content.push({ type: 'text', text: buildPrompt(client, note) });
  try {
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: 1200, messages: [{ role: 'user', content }] }),
    });
    const data = await res.json().catch(() => null);
    await logClaude(env, env.ANTHROPIC_MODEL || DEFAULT_MODEL, data, 'post captions');
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return parseCaptionJson(text);
  } catch (err) {
    console.error('caption generation failed, using template', err);
    return { ...templateCaptions(client, note), error: String(err.message || err) };
  }
}
