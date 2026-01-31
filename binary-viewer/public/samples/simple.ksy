meta:
  id: simple_binary
  endian: le
  encoding: utf-8

doc: テスト用のシンプルなバイナリ形式

seq:
  - id: magic
    type: u4
    contents: [0x41, 0x42, 0x43, 0x44]
    doc: マジックナンバー "ABCD"
  - id: version
    type: u2
    doc: バージョン番号
  - id: flags
    type: u1
    doc: フラグ
  - id: name_length
    type: u1
    doc: 名前の長さ
  - id: name
    type: str
    size: name_length
    doc: 名前
  - id: data_count
    type: u2
    doc: データエントリの数
  - id: entries
    type: data_entry
    repeat: expr
    repeat-expr: data_count

types:
  data_entry:
    doc: データエントリ
    seq:
      - id: id
        type: u4
        doc: エントリID
      - id: value
        type: s4
        doc: 値（符号付き32ビット）
