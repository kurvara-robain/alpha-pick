import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // jsdom 30 + vitest 4.1.10 下 window.localStorage 可能缺失，
    // setup 文件提供内存实现兜底（详见 vitest.setup.ts）
    setupFiles: ['./vitest.setup.ts'],
    // 显式给定 http origin（避免 opaque origin 下无 storage）
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:7200/',
      },
    },
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
