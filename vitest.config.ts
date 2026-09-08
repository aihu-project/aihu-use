import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __DEV__: 'true' },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**'],
    passWithNoTests: false,
  },
})
