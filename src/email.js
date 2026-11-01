// Optional email through Resend. Without RESEND_API_KEY the app hands back links to send yourself.
export function canEmail(env) {
  return Boolean(env.RESEND_API_KEY);
}

export async function sendEmail(env, { to, subject, text, html, replyTo }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) throw new Error('Email is not set up yet.');
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Rightway Growth <hello@rightwaygrowth.com>',
      to: [to], subject, text, html: html || undefined, reply_to: replyTo || undefined,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Email failed (HTTP ${res.status})`);
  }
  return true;
}
