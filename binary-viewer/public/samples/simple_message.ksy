meta:
  id: simple_message
  endian: be
  encoding: utf-8

doc: ダンプログのデモ用のシンプルな通信メッセージ形式

seq:
  - id: magic
    type: u2
    contents: [0xAA, 0x55]
    doc: 先頭マーカー
  - id: command
    type: u1
    doc: コマンド番号
  - id: seq_no
    type: u1
    doc: シーケンス番号
  - id: length
    type: u2
    doc: ペイロード長
  - id: payload
    type: str
    size: length
    doc: ペイロード（文字列）
  - id: checksum
    type: u1
    doc: チェックサム
