import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/features/**', 'src/shared/lib/**'],
      exclude: [
        'src/test/**',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/.gitkeep',
        '**/types.ts',
        'src/features/auth/**',
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
})
