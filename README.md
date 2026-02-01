# Binary Viewer

ブラウザ上でバイナリファイルの構造を可視化するツールです。

## 🌐 デモ

**[https://pecology.github.io/BinaryViewer/](https://pecology.github.io/BinaryViewer/)**

## 機能

- バイナリファイルの16進数表示
- 構造のツリー表示（アコーディオン形式）
- KSY形式によるカスタムパーサー定義
- Hex編集機能
- ファイルダウンロード
- 拡張子とパーサーの自動紐付け

## KSYファイルの作り方

KSYは[Kaitai Struct](https://kaitai.io/)のスキーマ形式をベースにした、バイナリ構造を定義するためのYAML形式ファイルです。

### 基本構造

```yaml
meta:
  id: my_format        # スキーマの識別子
  endian: le           # エンディアン（le: リトルエンディアン, be: ビッグエンディアン）

seq:                   # フィールドの並び（上から順に読み込まれる）
  - id: magic          # フィールド名
    type: u4           # 型
  - id: version
    type: u2
```

### JSON形式での記述

KSYスキーマはJSON形式でも記述できます：

```json
{
  "meta": {
    "id": "my_format",
    "endian": "le"
  },
  "seq": [
    { "id": "magic", "type": "u4" },
    { "id": "version", "type": "u2" }
  ]
}
```

### 対応している型

| 型名 | 説明 |
|------|------|
| `u1` | 符号なし1バイト整数 |
| `u2`, `u2le`, `u2be` | 符号なし2バイト整数（エンディアン指定可） |
| `u4`, `u4le`, `u4be` | 符号なし4バイト整数 |
| `s1` | 符号あり1バイト整数 |
| `s2`, `s2le`, `s2be` | 符号あり2バイト整数 |
| `s4`, `s4le`, `s4be` | 符号あり4バイト整数 |
| `str` | 固定長文字列（`size`必須） |
| `strz` | NULL終端文字列 |

### 配列（繰り返し）

```yaml
seq:
  - id: entries
    type: entry
    repeat: expr
    repeat-expr: 10    # 10回繰り返し（数値またはフィールド参照）
```

### ユーザー定義型

```yaml
meta:
  id: my_format
  endian: le

seq:
  - id: header
    type: file_header
  - id: records
    type: record
    repeat: expr
    repeat-expr: header.count

types:
  file_header:
    seq:
      - id: magic
        type: u4
      - id: count
        type: u2

  record:
    seq:
      - id: name
        type: str
        size: 32
        encoding: UTF-8
      - id: value
        type: u4
```

### 固定値の検証（contents）

マジックナンバーなど、特定のバイト列を期待する場合：

```yaml
seq:
  - id: magic
    type: u4
    contents: [0x50, 0x4B, 0x03, 0x04]  # "PK\x03\x04" (ZIP形式)
```

### 完全な例：シンプルなファイル形式

```yaml
meta:
  id: simple_format
  endian: le
  file-extension: dat

seq:
  - id: signature
    type: u4
    contents: [0x44, 0x41, 0x54, 0x41]  # "DATA"
  - id: version
    type: u2
  - id: record_count
    type: u2
  - id: records
    type: data_record
    repeat: expr
    repeat-expr: record_count

types:
  data_record:
    seq:
      - id: id
        type: u4
      - id: name
        type: str
        size: 16
        encoding: ASCII
      - id: value
        type: s4
```

## ローカル開発

```bash
cd binary-viewer
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## ライセンス

MIT
