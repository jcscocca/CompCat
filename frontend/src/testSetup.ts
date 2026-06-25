/**
 * Vitest global setup — runs before every test file.
 *
 * Node 25 exposes a built-in `localStorage` global (via --localstorage-file)
 * that does not implement the full Web Storage API (.clear, .key, .length).
 * This shim replaces that broken object with a compliant in-memory
 * implementation so jsdom-environment tests can use localStorage normally.
 *
 * jsdom does not implement PointerEvent, so @testing-library/dom falls back
 * to the base Event constructor which does not carry clientX/clientY.
 * This shim extends MouseEvent (which does carry those coordinates) so that
 * fireEvent.pointerDown/pointerMove/pointerUp receive the correct clientX
 * values in pointer-drag tests.
 */

function makeInMemoryStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

if (
  typeof (globalThis as Record<string, unknown>).PointerEvent === "undefined" &&
  typeof (globalThis as Record<string, unknown>).MouseEvent !== "undefined"
) {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(globalThis, "PointerEvent", {
    value: PointerEventShim,
    configurable: true,
    writable: true,
  });
}

Object.defineProperty(globalThis, "localStorage", {
  value: makeInMemoryStorage(),
  configurable: true,
  writable: true,
});
