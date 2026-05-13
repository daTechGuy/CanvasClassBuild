import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The React plugin handles the JSX transform so component tests (.test.tsx)
  // don't need an explicit `import React from 'react'`.
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    server: { deps: { inline: ['jszip', 'mammoth'] } },
  },
});
