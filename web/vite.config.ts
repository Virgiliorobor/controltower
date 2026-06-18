import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is the BUILD tool — we ship the built bundle (no `vite dev` against localhost, Rule 1).
// `base: '/'` produces absolute asset paths (/assets/...) so bundles load correctly regardless of the
// current URL depth (e.g. /process/:id hard-refresh). Fastify static serves /assets/* from webDir root.
// The SPA talks to the API only via RELATIVE /api paths (see src/lib/api.ts) — no hardcoded host anywhere.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});
