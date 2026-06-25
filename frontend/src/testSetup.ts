/**
 * Vitest global setup — runs before every test file.
 *
 * Node 25 exposes a built-in `localStorage` global (via --localstorage-file)
 * that does not implement the full Web Storage API (.clear, .key, .length).
 * This shim replaces that broken object with a compliant in-memory
 * implementation so jsdom-environment tests can use localStorage normally.
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

if (typeof globalThis !== "undefined") {
  const ls = makeInMemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: ls,
    configurable: true,
    writable: true,
  });
}
