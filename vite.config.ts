import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Same client URL works in dev and prod: `/api/ollama-proxy`.
// In dev: this proxy block rewrites it to https://ollama.com/api/chat.
// In prod: api/ollama-proxy.ts (Vercel Edge function) handles it.
// Either way the browser sees a same-origin request, sidestepping the
// missing CORS headers on ollama.com.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      '/api/ollama-proxy': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: () => '/api/chat',
      },
    },
  },
})
