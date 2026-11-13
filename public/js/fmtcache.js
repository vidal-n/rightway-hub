// Intl.DateTimeFormat objects are slow to build (tens of microseconds) and the Worker used to build one per lead per request.
// This keeps one per locale and option set. Pure, shared by the Worker and the app.
const cache = new Map();
export const dtf = (locale, opts) => {
  const k = `${locale}|${JSON.stringify(opts)}`;
  let f = cache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(locale, opts); cache.set(k, f); }
  return f;
};
