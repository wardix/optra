import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/optra/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/optra/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/optra/, ''),
        changeOrigin: true,
      }
    }
  }
})
