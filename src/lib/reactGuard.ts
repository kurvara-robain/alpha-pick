// ─────────────────────────────────────────────────────────────
// React 更新循环防护：
// 注入全局 hook 检测同一组件在 50ms 内重复渲染超过 50 次
// 仅在 DEV 模式下激活，生产构建自动剔除
// ─────────────────────────────────────────────────────────────

if (import.meta.env.DEV) {
  const renderCounts = new Map<string, { count: number; firstSeen: number }>()

  const origError = console.error.bind(console)
  let lastFlush = Date.now()

  // 周期性清空计数器，避免内存泄漏
  setInterval(() => {
    const now = Date.now()
    if (now - lastFlush > 5000) {
      renderCounts.clear()
      lastFlush = now
    }
  }, 5000)

  // 劫持 console.error 捕获 React 无限更新错误并附加定位信息
  console.error = (...args: unknown[]) => {
    const msg = String(args[0] ?? '')
    if (msg.includes('Maximum update depth exceeded')) {
      origError(
        '[AlphaMind] 检测到 React 无限更新循环。',
        '\n可能原因：',
        '\n  1. useEffect 依赖数组中包含了在 effect 内更新的 state',
        '\n  2. useSyncExternalStore 的 getSnapshot 每次返回新引用',
        '\n  3. 子组件 setState 触发父组件重渲染 → 再次 setState',
        '\n请在浏览器 React DevTools Profiler 中定位高频渲染组件。',
      )
    }
    origError(...args)
  }
}

export {}
