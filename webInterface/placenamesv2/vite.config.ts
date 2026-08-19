import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy SPARQL requests to bypass CORS during development.
    // Browser sends request to localhost:5173/sparql → Vite forwards it to the EC2 server.
    // This is a development-only workaround. In production, the app and Fuseki
    // will be on the same domain (no CORS issue).
    proxy: {
      '/sparql': {
        target: 'https://placenames.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/sparql/, '/fuseki/geo20260709'),
        timeout: 120000, // 2 minute timeout for large queries
      },
    },
  },
})
