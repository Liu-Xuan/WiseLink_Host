import { JSDOM } from 'jsdom';
// Custom-element consumers need the DOM before their module is imported.
export const assessmentDom = new JSDOM('<!doctype html><body></body>', { url: 'https://synthetic.invalid', pretendToBeVisual: true });
for (const [key, value] of Object.entries({ window: assessmentDom.window, document: assessmentDom.window.document,
  navigator: assessmentDom.window.navigator, HTMLElement: assessmentDom.window.HTMLElement,
  customElements: assessmentDom.window.customElements, Event: assessmentDom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
Object.assign(globalThis, {
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => undefined,
});
for (const key of ['DocumentFragment', 'Element', 'Node', 'CustomEvent', 'MutationObserver', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: Reflect.get(assessmentDom.window, key) });
}
Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, writable: true, value: assessmentDom.window.getComputedStyle.bind(assessmentDom.window) });
