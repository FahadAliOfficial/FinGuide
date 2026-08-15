import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] }
  }
});
