import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { checkProductionCsp, replaceCsp, toDevCsp } from './scripts/seo/csp.mjs'

// index.html ships the strict production CSP. The dev server needs inline/eval
// scripts (React Refresh preamble) and localhost sources (HMR, local broadcast
// server), so add those only when serving; at build time, verify the policy.
function cspPlugin() {
  return [
    {
      name: 'sisyfuz-csp-dev',
      apply: 'serve',
      transformIndexHtml: (html) => replaceCsp(html, toDevCsp),
    },
    {
      name: 'sisyfuz-csp-check',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          const problems = checkProductionCsp(html)
          if (problems.length) {
            throw new Error(`index.html Content-Security-Policy:\n  - ${problems.join('\n  - ')}`)
          }
          return html
        },
      },
    },
  ]
}

// https://vite.dev
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),
  ],
  base: '/', // Zorgt dat paden relatief zijn voor GitHub Pages
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-sanity': ['@sanity/client', '@sanity/image-url'],
        },
      },
    },
  },
})
