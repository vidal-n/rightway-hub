// Runs during `wrangler deploy` (custom build in wrangler.jsonc).
// Copies secrets saved in Cloudflare's Build "Variables and secrets" into the deployed Worker,
// so they work even if they were never added as runtime secrets. Values are trimmed to drop stray spaces.
// The output file lives only inside the deployed Worker; it is never served to browsers.
import { writeFileSync } from 'node:fs';

const KEYS = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'ACCESS_KEY', 'PAGESPEED_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'RESEND_API_KEY', 'EMAIL_FROM',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const found = {};
for (const k of KEYS) {
  const v = process.env[k];
  if (typeof v === 'string' && v.trim()) found[k] = v.trim();
}

if (!Object.keys(found).length) {
  console.log('[bake-secrets] No build secrets found; leaving src/runtime-secrets.js as is.');
} else {
  writeFileSync(new URL('../src/runtime-secrets.js', import.meta.url),
    `// Generated at build time. Do not commit real values.\nexport default ${JSON.stringify(found)};\n`);
  console.log(`[bake-secrets] Baked: ${Object.keys(found).join(', ')}`);
}
