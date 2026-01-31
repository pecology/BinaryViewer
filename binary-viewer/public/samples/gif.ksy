meta:
  id: gif
  file-extension: gif
  endian: le
  encoding: ascii

doc: GIF (Graphics Interchange Format) 画像フォーマット

seq:
  - id: header
    type: header
  - id: logical_screen_descriptor
    type: logical_screen_descriptor

types:
  header:
    doc: GIFヘッダー (6バイト)
    seq:
      - id: magic
        type: str
        size: 3
        doc: "GIF" マジックナンバー
      - id: version
        type: str
        size: 3
        doc: バージョン ("87a" or "89a")

  logical_screen_descriptor:
    doc: 論理画面記述子
    seq:
      - id: width
        type: u2
        doc: 画像の幅
      - id: height
        type: u2
        doc: 画像の高さ
      - id: flags
        type: u1
        doc: パックドフィールド
      - id: bg_color_index
        type: u1
        doc: 背景色インデックス
      - id: pixel_aspect_ratio
        type: u1
        doc: ピクセルアスペクト比
