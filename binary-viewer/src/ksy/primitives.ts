/**
 * プリミティブ型の読み取り関数
 * DataViewを使用してバイナリデータから値を読み取る
 */

import type { PrimitiveTypeInfo } from './KsySchema';

/**
 * 符号なし整数を読み取る
 */
export function readUnsigned(
    dataView: DataView,
    offset: number,
    size: number,
    littleEndian: boolean
): number {
    switch (size) {
        case 1:
            return dataView.getUint8(offset);
        case 2:
            return dataView.getUint16(offset, littleEndian);
        case 3:
            // 3バイト整数は手動で処理
            if (littleEndian) {
                return dataView.getUint8(offset) |
                       (dataView.getUint8(offset + 1) << 8) |
                       (dataView.getUint8(offset + 2) << 16);
            } else {
                return (dataView.getUint8(offset) << 16) |
                       (dataView.getUint8(offset + 1) << 8) |
                       dataView.getUint8(offset + 2);
            }
        case 4:
            return dataView.getUint32(offset, littleEndian);
        default:
            throw new Error(`Unsupported unsigned integer size: ${size}`);
    }
}

/**
 * 符号付き整数を読み取る
 */
export function readSigned(
    dataView: DataView,
    offset: number,
    size: number,
    littleEndian: boolean
): number {
    switch (size) {
        case 1:
            return dataView.getInt8(offset);
        case 2:
            return dataView.getInt16(offset, littleEndian);
        case 3:
            // 3バイト符号付き整数は手動で処理
            const unsigned = readUnsigned(dataView, offset, 3, littleEndian);
            // 符号拡張: 最上位ビットが1なら負数
            if (unsigned & 0x800000) {
                return unsigned - 0x1000000;
            }
            return unsigned;
        case 4:
            return dataView.getInt32(offset, littleEndian);
        default:
            throw new Error(`Unsupported signed integer size: ${size}`);
    }
}

/**
 * プリミティブ型情報に基づいて値を読み取る
 */
export function readPrimitive(
    dataView: DataView,
    offset: number,
    typeInfo: PrimitiveTypeInfo
): number {
    const littleEndian = typeInfo.endian === 'le';
    
    if (typeInfo.signed) {
        return readSigned(dataView, offset, typeInfo.size, littleEndian);
    } else {
        return readUnsigned(dataView, offset, typeInfo.size, littleEndian);
    }
}

/**
 * 文字列を読み取る（固定長）
 */
export function readString(
    dataView: DataView,
    offset: number,
    size: number,
    encoding: string = 'utf-8'
): string {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, size);
    const decoder = new TextDecoder(getTextDecoderEncoding(encoding));
    return decoder.decode(bytes);
}

/**
 * Null終端文字列を読み取る
 * @returns [文字列, 読み取ったバイト数（null含む）]
 */
export function readStringZ(
    dataView: DataView,
    offset: number,
    maxSize?: number,
    encoding: string = 'utf-8'
): [string, number] {
    const buffer = dataView.buffer;
    const start = dataView.byteOffset + offset;
    const end = maxSize !== undefined 
        ? Math.min(start + maxSize, buffer.byteLength)
        : buffer.byteLength;
    
    // null文字を探す
    let nullPos = -1;
    for (let i = start; i < end; i++) {
        if (new Uint8Array(buffer)[i] === 0) {
            nullPos = i;
            break;
        }
    }

    if (nullPos === -1) {
        // null文字が見つからない場合は末尾まで
        const bytes = new Uint8Array(buffer, start, end - start);
        const decoder = new TextDecoder(getTextDecoderEncoding(encoding));
        return [decoder.decode(bytes), end - start];
    }

    const size = nullPos - start;
    const bytes = new Uint8Array(buffer, start, size);
    const decoder = new TextDecoder(getTextDecoderEncoding(encoding));
    return [decoder.decode(bytes), size + 1]; // +1 for null terminator
}

/**
 * バイト配列を読み取る
 */
export function readBytes(
    dataView: DataView,
    offset: number,
    size: number
): Uint8Array {
    return new Uint8Array(dataView.buffer, dataView.byteOffset + offset, size);
}

/**
 * エンコーディング名をTextDecoderが理解できる形式に変換
 */
function getTextDecoderEncoding(encoding: string): string {
    const lower = encoding.toLowerCase();
    const encodingMap: Record<string, string> = {
        'utf-8': 'utf-8',
        'utf8': 'utf-8',
        'ascii': 'ascii',
        'shift_jis': 'shift_jis',
        'shift-jis': 'shift_jis',
        'sjis': 'shift_jis',
        'shiftjis': 'shift_jis',
        'euc-jp': 'euc-jp',
        'eucjp': 'euc-jp',
        'iso-8859-1': 'iso-8859-1',
        'latin1': 'iso-8859-1',
        'utf-16le': 'utf-16le',
        'utf-16be': 'utf-16be',
        'cp437': 'cp437',
    };
    return encodingMap[lower] ?? lower;
}
