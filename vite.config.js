import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: 'src/main/mainProcess.js',
      },
      {
        // Preload 脚本入口
        entry: 'src/preload/index.js',
        onstart(options) {
          // 在开发模式下，当 preload 脚本构建完成后，重新加载渲染进程
          options.reload();
        },
      },
    ]),
  ],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      external: ['better-sqlite3', 'electron-screenshots']
    }
  },
  server: {
    port: 5173,
  }
});

