# CLAUDE.md

ブラウザ上でバイナリファイルの構造を可視化するツール。TypeScript + Vite 製で、ランタイム依存ライブラリはゼロ（YAMLパーサー等もすべて自前実装）。ビルド成果物は単一HTMLファイル。

## ディレクトリ構成

- アプリ本体は `binary-viewer/` 配下。npm コマンドはすべてこのディレクトリで実行する
- `.github/workflows/deploy.yml` — `main` への push で型チェック＋ビルドし GitHub Pages に公開
- `TODO.txt` — 未着手の改善案リスト
- `binary-viewer/docs/ksy-implementation-spec.md` — KSYパーサーの仕様と設計判断。KSY関連を変更する前に読むこと
- `binary-viewer/public/samples/*.ksy` — サンプルスキーマ

## コマンド

```bash
cd binary-viewer
npm run dev      # 開発サーバー
npm run build    # tsc による型チェック + vite build（dist/index.html に単一HTMLを出力）
```

テストフレームワークや linter は無い。変更後は `npm run build` が通ることを必ず確認する（CI もこれを実行する）。tsconfig は `strict` + `noUnusedLocals` / `noUnusedParameters` / `erasableSyntaxOnly` なので、未使用の変数・import や `enum` 等はビルドエラーになる。

## アーキテクチャ

- `src/BinaryRange.ts` — 中心となるデータモデル。バイト範囲（`Uint8Array` のサブビュー）・名前・解釈型・子範囲を持つツリー。全パーサーはこれを返す
- `src/BinaryInterpretType.ts` — バイト列の解釈・表示方法（整数、文字列など）
- `src/parserRegistry.ts` — 組み込みパーサー（ZIP / Text）の登録。新しい組み込みパーサーは `BinaryParser` を実装してここに追加する
- `src/ksy/` — KSY（Kaitai Struct 風）エンジン
  - `YamlParser.ts` 簡易YAMLパーサー / `KsySchema.ts` 型定義 / `DynamicParser.ts` スキーマ→`BinaryRange` ツリー変換（repeat, if 条件, 式評価, ユーザー定義型）/ `CsvSchema.ts` CSV⇔YAML 変換 / `primitives.ts` 基本型
- `src/ksyStorage.ts`, `src/extensionMapping.ts` — ユーザー定義スキーマと拡張子紐付けを localStorage に保存
- `src/main.ts` — UI 全体（約2300行）。`#app` に HTML テンプレートを innerHTML で流し込み、モジュールスコープの変数で状態を持つ。ファイル読込、Hexテーブル（ページング）、構造ツリー（`<details>` アコーディオン）、Hex編集→再パース、KSY管理モーダル、ダンプログ表示（仮想スクロール）を含む

処理の流れ: ファイル読込 → パーサー決定（組み込み / KSY / 拡張子紐付け）→ `BinaryRange` ツリー生成 → Hexテーブルと構造ツリーを描画 → 双方向ハイライト

## 規約

- コメント・ドキュメントは日本語
- インデントは4スペース
- ファイル名・ログ等の外部由来文字列を HTML に埋め込むときは `escapeHtml` を通す
- 外部ライブラリは追加しない（単一HTML・依存ゼロの方針）
- KSY の機能を追加・変更したら `README.md` の KSY 説明と `docs/ksy-implementation-spec.md` も更新する
