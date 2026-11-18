import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repo root; only VITE_* values reach the browser bundle.
  envDir: '../../',
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
    // Transform the app graph at startup, so a cold server (CI, Playwright) doesn't discover dependencies on the
    // first page load and full-reload every open tab mid-test.
    warmup: { clientFiles: ['./src/main.tsx'] },
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'react-router', '@tanstack/react-query', '@okta/okta-auth-js/core', 'zod', 'dynaura', 'lucide-react'],
  },
  // Only unit tests; e2e/ is Playwright's.
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
