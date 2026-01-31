meta:
  id: png
  file-extension: png
  endian: be
  encoding: ascii

doc: PNG (Portable Network Graphics) 画像フォーマット

seq:
  - id: signature
    type: u4
    contents: [0x89, 0x50, 0x4e, 0x47]
    doc: PNG シグネチャ (前半)
  - id: signature2
    type: u4
    contents: [0x0d, 0x0a, 0x1a, 0x0a]
    doc: PNG シグネチャ (後半)
  - id: ihdr_length
    type: u4
    doc: IHDRチャンクの長さ
  - id: ihdr_type
    type: str
    size: 4
    doc: チャンクタイプ "IHDR"
  - id: ihdr
    type: ihdr_chunk

types:
  ihdr_chunk:
    doc: IHDR (Image Header) チャンク
    seq:
      - id: width
        type: u4
        doc: 画像の幅
      - id: height
        type: u4
        doc: 画像の高さ
      - id: bit_depth
        type: u1
        doc: ビット深度
      - id: color_type
        type: u1
        doc: カラータイプ
      - id: compression_method
        type: u1
        doc: 圧縮方式
      - id: filter_method
        type: u1
        doc: フィルター方式
      - id: interlace_method
        type: u1
        doc: インターレース方式
