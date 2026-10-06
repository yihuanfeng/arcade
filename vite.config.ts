import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './'：构建产物可用相对路径部署（任意子路径 / file:// 场景），沿用 openrocket-web 的教训
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    host: true,
    port: 5174,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
})
