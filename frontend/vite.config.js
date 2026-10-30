import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发期：/api 由 Vite 代理转发到 Spring Boot(8080)，页面与接口同源无跨域；
// 生产期：build 产物拷回 Spring Boot static 同源伺服，代理不参与
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
