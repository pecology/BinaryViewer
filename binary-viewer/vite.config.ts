import { defineConfig } from 'vite'

import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  // ローカルでHTMLを開く場合やGitHub Pagesでも動くように相対パスにする
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    // 1ファイルに固めるためソースマップは無効化（軽量化のため）
    sourcemap: false,
  },
})
