import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/tui-*.test.ts', 'tests/tui/**/*.test.ts'],
    testTimeout: 20000,
  },
})
