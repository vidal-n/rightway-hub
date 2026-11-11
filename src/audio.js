// Call recordings and voicemails, served so every player can seek and the whole call plays.
// Twilio streams the mp3 without a length, which makes browsers cut playback short and block scrubbing. So the first time one is
// played we keep a copy in R2 (rec/<sid>.mp3), then answer with a real Content-Length and proper Range (206) replies from that copy.
import { HttpError } from './util.js';

export const recKey = (sid) => `rec/${sid}.mp3`;

export async function forgetRecording(env, sid) {
  if (sid && env.MEDIA) await env.MEDIA.delete(recKey(sid)).catch(() => {});
}

function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((h || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let end;
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start > end || start >= size) return { bad: true };
  return { start, end };
}

// twilioUrl: the Recordings/<sid>.mp3 address. twilioAuth: the Authorization header value.
export async function serveRecording(env, request, { sid, twilioUrl, twilioAuth, filename = 'recording.mp3', download = false, gone = 'Twilio did not return the recording. It may have been deleted.' }) {
  const key = recKey(sid);
  let size = null;
  if (env.MEDIA) { const head = await env.MEDIA.head(key).catch(() => null); if (head) size = head.size; }
  let bytes = null;
  if (size == null) {
    const res = await fetch(twilioUrl, { headers: { Authorization: twilioAuth } });
    if (!res.ok) throw new HttpError(gone, 502);
    bytes = new Uint8Array(await res.arrayBuffer());
    size = bytes.length;
    if (env.MEDIA) await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }).catch(() => {});
  }
  const base = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
  if (download) base['content-disposition'] = `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"`;
  const range = parseRange(request.headers.get('range'), size);
  if (range?.bad) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  let body;
  if (bytes) body = bytes.slice(start, end + 1);
  else {
    const obj = await env.MEDIA.get(key, range ? { range: { offset: start, length: end - start + 1 } } : undefined);
    if (!obj) throw new HttpError(gone, 502);
    body = obj.body;
  }
  const headers = { ...base, 'content-length': String(end - start + 1) };
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}
