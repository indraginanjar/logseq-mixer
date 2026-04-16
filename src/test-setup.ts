/**
 * Test setup for vitest + jsdom + React 17
 */

export { };

// jsdom doesn't implement scrollIntoView
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}
