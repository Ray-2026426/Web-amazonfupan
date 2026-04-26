import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/dashscope': {
            target: 'https://dashscope.aliyuncs.com',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/dashscope/, ''),
          },
          '/zhipu': {
            target: 'https://open.bigmodel.cn',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/zhipu/, ''),
          },
          '/openrouterfans': {
            target: 'https://openrouter.fans/v1',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/openrouterfans/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
