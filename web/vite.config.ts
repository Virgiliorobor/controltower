import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is the BUILD tool — we ship the built bundle (no `vite dev` against localhost, Rule 1).
// `base: './'` keeps asset URLs relative so the bundle is served by the Fastify static host at any path.
// The SPA talks to the API only via RELATIVE /api paths (see src/lib/api.ts) — no hardcoded host anywhere.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});
