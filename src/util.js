export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function keyMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function cleanText(value, field, max) {
  if (typeof value !== 'string') throw new HttpError(`${field} is required.`);
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) throw new HttpError(`${field} is required.`);
  if (v.length > max) throw new HttpError(`${field} is too long (max ${max} characters).`);
  return v;
}

function num(value, field, min, max) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(`${field} must be a number between ${min} and ${max}.`);
  }
  return n;
}

export function validateSearch(body) {
  return {
    name: cleanText(body?.name, 'Business name', 120),
    location: cleanText(body?.location, 'City and state', 80),
  };
}

export function validateGridPoint(body) {
  const zoom = Math.round(num(body?.zoom ?? 13, 'Zoom', 10, 18));
  const out = {
    keyword: cleanText(body?.keyword, 'Keyword', 80),
    lat: num(body?.lat, 'Latitude', -90, 90),
    lng: num(body?.lng, 'Longitude', -180, 180),
    zoom,
    cid: typeof body?.cid === 'string' ? body.cid.slice(0, 64) : '',
    place_id: typeof body?.place_id === 'string' ? body.place_id.slice(0, 128) : '',
  };
  if (!out.cid && !out.place_id) throw new HttpError('Pick a business first (cid or place_id missing).');
  return out;
}

export function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 300) throw new HttpError('Website URL is required.');
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new HttpError('That website URL is not valid.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError('Website URL must start with http or https.');
  return u.toString();
}
