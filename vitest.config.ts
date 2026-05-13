import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom gives us a DOMParser polyfill so the template parser and
    // exporter (both call `new DOMParser()`) work in Node tests without
    // any extra setup-file ceremony.
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Network calls in tests are always a bug — fail fast if anything
    // accidentally hits ollama.com / anthropic / etc.
    server: { deps: { inline: ['jszip', 'mammoth'] } },
  },
});
