// Puts a hash of everything the browser downloads from public/ into the service worker's cache name (public/sw.js, `const CACHE`).
// The service worker serves scripts and styles from its cache, so the name has to change whenever any of them change.
// Runs on deploy (wrangler.jsonc build command). `node scripts/stamp-sw.mjs --check` only reports (test/swstamp.test.js uses `stampFor`).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const walk = (dir) => readdirSync(dir).sort().flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (relative(PUBLIC, p) === 'training' ? [] : walk(p)) : [p];
});
export function stampFor(dir = PUBLIC) {
  const h = createHash('sha256');
  for (const p of walk(dir)) {
    const rel = relative(dir, p).replaceAll('\\', '/');
    // sw.js counts too, minus the two lines this script writes.
    const data = rel === 'sw.js' ? readFileSync(p, 'utf8').replace(/const CACHE = '[^']+'/, '').replace(/const SHELL = \[[\s\S]*?\];/, '') : readFileSync(p);
    h.update(rel).update('\0').update(data).update('\0');
  }
  return `rw-hub-${h.digest('hex').slice(0, 12)}`;
}
// Everything the Hub loads to run, so a new version is complete in the cache before it takes over.
export function shellList(dir = PUBLIC) {
  const own = (sub, re) => readdirSync(join(dir, sub)).sort().filter((n) => re.test(n)).map((n) => `/${sub}/${n}`);
  return ['/', '/index.html', '/hub.css', '/hub5.css', '/styles.css', '/app.js', '/manifest.webmanifest', ...own('hub', /\.(js|css)$/), ...own('js', /\.js$/), ...own('brand', /\.(svg|png)$/)];
}
export const swPath = join(PUBLIC, 'sw.js');
export const currentName = () => (readFileSync(swPath, 'utf8').match(/const CACHE = '([^']+)'/) || [])[1];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = stampFor();
  if (process.argv.includes('--check')) { console.log(currentName() === next ? 'current' : `stale: ${currentName()} should be ${next}`); process.exit(currentName() === next ? 0 : 1); }
  const shell = `const SHELL = [${shellList().map((u) => `'${u}'`).join(', ')}];`;
  writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const CACHE = '[^']+'/, `const CACHE = '${next}'`).replace(/const SHELL = \[[\s\S]*?\];/, () => shell));
  console.log(`[stamp-sw] cache name ${next}, ${shellList().length} files precached`);
}
