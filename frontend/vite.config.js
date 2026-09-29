import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // /api 요청을 백엔드(FastAPI)로 전달
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
