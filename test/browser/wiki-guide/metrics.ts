// Test instrumentation observes ordinary UI events; it never clicks, reads React state or invokes APIs.
interface Sample { kind: string; label: string; elapsedMs: number; apiRequests: number }
const samples: Sample[] = [];
let pending: { kind: string; label: string; startedAt: number; requests: number } | null = null;
let queued = false, firstReadableMs: number | null = null, interactiveMs: number | null = null;
const requests = (): number => performance.getEntriesByType('resource')
  .filter(entry => new URL(entry.name).pathname.startsWith('/api/')).length;
function expose(): void {
  document.documentElement.dataset.wikiFixtureMetrics = JSON.stringify({
    fixtureOnly: true, firstReadableMs, interactiveMs, sampleN: samples.length, samples,
  });
}
function inspect(): void {
  const page = document.querySelector('main.wiki-guide-home');
  if (!page) return;
  if (firstReadableMs === null && page.querySelector('.wg-workbench')) firstReadableMs = performance.now();
  if (page.getAttribute('aria-busy') !== 'false' || queued) { expose(); return; }
  if (!pending && interactiveMs !== null) return;
  queued = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    queued = false;
    if (page.getAttribute('aria-busy') !== 'false') return;
    if (interactiveMs === null) interactiveMs = performance.now();
    if (pending) {
      samples.push({ kind: pending.kind, label: pending.label, elapsedMs: performance.now() - pending.startedAt,
        apiRequests: requests() - pending.requests });
      pending = null;
    }
    expose();
  }));
}
document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest<HTMLButtonElement>('.wg-models button, button.wg-chapter, .wg-heading-actions button');
  if (!control || control.disabled) return;
  pending = { kind: control.closest('.wg-models') ? 'model' : control.classList.contains('wg-chapter') ? 'chapter' : 'refresh',
    label: control.textContent?.trim() ?? '', startedAt: performance.now(), requests: requests() };
  inspect();
}, true);
new MutationObserver(inspect).observe(document.documentElement, {
  subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'aria-pressed', 'aria-current'],
});
expose();
