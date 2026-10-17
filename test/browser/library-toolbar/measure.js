// Local-only event/DOM/frame-opportunity evidence, never a production telemetry hook.
performance.setResourceTimingBufferSize(4000);
window.libraryFixtureTimings = [];
function businessRequests(start) {
  return performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.startsWith('/api/') && entry.startTime >= start)
    .map(entry => ({ path: new URL(entry.name).pathname, duration: entry.duration, bytes: entry.encodedBodySize }));
}
function visible(mode) {
  if (!document.querySelector('.library-source-directory') || document.querySelectorAll('.wl-pagebar').length !== 1) return false;
  if (mode === 'matter') return Boolean(document.querySelector('.suite-matter-table tbody tr') &&
    document.querySelector('.atlas-library-inspector [data-result-ref]'));
  return Boolean(document.querySelector('.suite-document-table tbody tr') &&
    document.querySelector('.library-quicklook-assessment .suite-library-summary'));
}
function sample(name, start, predicate) {
  let frames = 0;
  const check = () => {
    if (!predicate() && frames++ < 600) return requestAnimationFrame(check);
    const domMs = performance.now() - start;
    requestAnimationFrame(() => requestAnimationFrame(() => window.libraryFixtureTimings.push({
      name, domMs, frameMs: performance.now() - start, timeout: frames >= 600, requests: businessRequests(start),
    })));
  };
  requestAnimationFrame(check);
}
sample('cold-document', 0, () => visible('document'));
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const start = performance.now();
  if (button.closest('.library-source-navigation')) {
    const mode = button.textContent === '工程事项' ? 'matter' : 'document';
    sample(mode, start, () => new URLSearchParams(location.search).get('mode') === mode && visible(mode));
  } else if (button.classList.contains('wl-pagebar-action')) {
    const expected = !document.querySelector('.wiselink-app-shell')?.classList.contains('is-immersive');
    sample(expected ? 'fullscreen-enter' : 'fullscreen-exit', start, () =>
      document.querySelector('.wiselink-app-shell')?.classList.contains('is-immersive') === expected);
  }
}, true);
