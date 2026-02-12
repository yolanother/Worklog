import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Increase default timeout to reduce intermittent test timeouts in CI
    testTimeout: 20000,
    // Run setup to inject mock git into PATH for spawn-based calls
    setupFiles: ['./tests/setup-tests.ts'],
  },
})
