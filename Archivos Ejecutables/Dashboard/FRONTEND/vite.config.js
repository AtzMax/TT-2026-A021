import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/davis': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/modelo': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/recomendacion': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/ia': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
