import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pagesのサブディレクトリにデプロイする場合のベースパス
  // リポジトリ名に合わせて変更してください（例: /BinaryViewer/）
  base: '/BinaryViewer/',
  build: {
    outDir: 'dist',
    // ソースマップを生成（本番でもTSファイルでデバッグ可能に）
    sourcemap: true,
  },
})
