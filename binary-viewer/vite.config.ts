import { defineConfig } from 'vite'

import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  // ローカルでHTMLを開く場合やGitHub Pagesでも動くように相対パスにする
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    // ソースマップを単一HTMLに埋め込む
    sourcemap: 'inline',
  },
})
