import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only proxy for Ollama Cloud. ollama.com does not set CORS headers, so
// browser-direct fetches are blocked. Routing through Vite makes the request
// same-origin from the browser's perspective. This is dev-only — production
// deployments need a server-side proxy (Vercel function, Cloudflare Worker)
// or a CORS-friendly provider (Groq, Together, OpenRouter).
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      '/ollama-proxy': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama-proxy/, ''),
      },
    },
  },
})
