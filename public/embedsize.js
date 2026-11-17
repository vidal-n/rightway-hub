/* Embedded scan reports its own height to the page that frames it, so the frame never scrolls on its own
   (V, Nov 2026: one scroll only). Measures the content box, not the viewport, so it can shrink as well as grow. */
if (document.documentElement.classList.contains('is-embed') && window.parent !== window) {
  let last = 0, raf = 0;
  const size = () => {
    raf = 0;
    const el = document.querySelector('.sx') || document.body;
    const h = Math.ceil(el.getBoundingClientRect().height);
    if (h && Math.abs(h - last) > 1) { last = h; try { window.parent.postMessage({ type: 'rw-embed-height', h, src: 'scan' }, location.origin); } catch { /* not same origin */ } }
  };
  const ask = () => { if (!raf) raf = requestAnimationFrame(size); };
  try { new ResizeObserver(ask).observe(document.querySelector('.sx') || document.body); } catch { setInterval(ask, 500); }
  new MutationObserver(ask).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', ask); window.addEventListener('resize', ask);
  ask();
}
