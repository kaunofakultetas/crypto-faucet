// -----------------------------------------------------------
//  [*] Vite configuration
//
//  Plugins:
//    - react       — JSX + fast refresh
//    - tailwindcss — Tailwind v4 (no tailwind.config file)
//
//  Also sets up:
//    - '@' → src alias (matches imports like '@/components/...';
//      jsconfig.json mirrors it for the editor)
//    - dev server on 0.0.0.0:80 so the Docker dev container
//      (faucet-vite, Dockerfile.dev) is reachable through the
//      Caddy endpoint
//    - the vitest block: jsdom, the tests/ tree, the shared
//      setup file (jest-dom matchers, the msw backend double,
//      browser API polyfills) and the coverage scope. Tests
//      run inside Docker only — see ../runTests.sh and
//      tests/README.md
// -----------------------------------------------------------

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 80,
    allowedHosts: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{js,jsx}'],
    setupFiles: ['tests/support/setup.js'],
    // MUI renders slowly under jsdom, and the contract
    // matrices mount a page many times per file
    testTimeout: 20000,
    hookTimeout: 20000,
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx'],
      reportsDirectory: 'coverage',
    },
  },
});
