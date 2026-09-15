import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 운영 화면.
 * 브라우저는 언제나 같은 출처의 /api를 부른다.
 * 운영에서는 Vercel 함수가 회사 계정 로그인과 Cloudflare 중계를 맡고,
 * 로컬에서는 아래 프록시가 Worker로 바로 잇는다(로컬 전용 개발 인증).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': process.env['ADMIN_API_URL'] ?? 'http://localhost:8788' },
  },
  preview: {
    port: 4174,
    strictPort: true,
    proxy: { '/api': process.env['ADMIN_API_URL'] ?? 'http://localhost:8788' },
  },
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: 'index.html' } },
});
