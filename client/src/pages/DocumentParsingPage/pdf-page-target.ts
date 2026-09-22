/** Follow one explicit page request while asynchronous canvas sizes settle.
 * A user's own scroll gesture takes ownership immediately; no permanent snapping.
 */
export function followPdfPageTarget(
  container: HTMLElement,
  page: number,
  onPosition: (scrollTop: number) => void,
): () => void {
  let following = true;
  let frame: number | null = null;
  const pages = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page]'));
  const target = pages.find(element => Number(element.dataset.pdfPage) === page);
  if (!target) return () => undefined;
  function align() {
    if (!following || !target || container.clientHeight === 0) return;
    const last = pages.at(-1);
    // A short last page needs enough trailing space to reach the reading line.
    // Only extend an already scrollable viewport, avoiding auto-height feedback.
    const trailing = last && container.scrollHeight > container.clientHeight + 1
      ? Math.max(6, container.clientHeight - last.getBoundingClientRect().height + 6) : 6;
    const padding = `${trailing}px`;
    if (container.style.paddingBottom !== padding) container.style.paddingBottom = padding;
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    if (Math.abs(offset) > 0.5) container.scrollTo({ top: Math.max(0, container.scrollTop + offset), behavior: 'auto' });
    onPosition(container.scrollTop);
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (!following || frame !== null) return;
    frame = window.requestAnimationFrame(() => { frame = null; align(); });
  });
  function stopFollowing() {
    following = false;
    observer?.disconnect();
    if (frame !== null) { window.cancelAnimationFrame(frame); frame = null; }
  }
  function onKey(event: KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopFollowing();
  }
  container.addEventListener('wheel', stopFollowing, { passive: true });
  container.addEventListener('touchstart', stopFollowing, { passive: true });
  container.addEventListener('pointerdown', stopFollowing, { passive: true });
  container.addEventListener('keydown', onKey);
  observer?.observe(container);
  pages.forEach(element => observer?.observe(element));
  align();
  return () => {
    stopFollowing();
    container.removeEventListener('wheel', stopFollowing);
    container.removeEventListener('touchstart', stopFollowing);
    container.removeEventListener('pointerdown', stopFollowing);
    container.removeEventListener('keydown', onKey);
  };
}
