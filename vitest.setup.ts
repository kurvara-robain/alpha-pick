// ─────────────────────────────────────────────────────────────
// Vitest 全局 setup
// jsdom 30 + vitest 4.1.10 环境下 window.localStorage 可能缺失
// （opaque origin / 环境集成差异），此处提供内存实现兜底，
// 保证依赖 storage 的领域测试（store / experimentRun / simTrade 等）可运行。
// ─────────────────────────────────────────────────────────────

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  } as Storage
}

function ensureStorage(target: object, prop: 'localStorage' | 'sessionStorage'): void {
  const existing = (target as Record<string, unknown>)[prop]
  if (existing !== undefined && existing !== null) return
  Object.defineProperty(target, prop, {
    value: createMemoryStorage(),
    writable: true,
    configurable: true,
  })
}

ensureStorage(globalThis, 'localStorage')
ensureStorage(globalThis, 'sessionStorage')
if (typeof window !== 'undefined') {
  ensureStorage(window, 'localStorage')
  ensureStorage(window, 'sessionStorage')
}
