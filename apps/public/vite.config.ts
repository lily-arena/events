import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 참여자 화면.
 * 브라우저는 언제나 같은 출처의 /api를 부른다.
 * 운영에서는 Vercel 함수가 그 요청을 Cloudflare로 중계하고,
 * 로컬에서는 아래 프록시가 같은 역할을 대신한다.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env['PUBLIC_API_URL'] ?? 'http://localhost:8787' },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': process.env['PUBLIC_API_URL'] ?? 'http://localhost:8787' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Admin 코드·개인키가 Public bundle에 섞이지 않도록 entry를 하나로 유지한다.
    rollupOptions: { input: 'index.html' },
  },
});
