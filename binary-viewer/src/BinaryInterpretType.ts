/**
 * 数値・バイト列の表示基数
 * - 'auto': 型ごとの既定（整数は10進、バイト列は16進）
 * - 10 / 16: 整数・バイト列をすべてその基数で表示
 */
export type DisplayRadix = 'auto' | 10 | 16;

export interface InterpretOptions {
    radix?: DisplayRadix;
}

export interface BinaryInterpretType {
    toString(): string;
    interpret(bytes: Uint8Array, options?: InterpretOptions): string;
}

/**
 * 整数を表示用の文字列にする
 * 16進は符号に関係なくバイト列そのままの値（2の補数）を、サイズ分ゼロ埋めして表示する
 */
export function formatInteger(bytes: Uint8Array, size: number, signed: boolean, littleEndian: boolean, radix: DisplayRadix = 'auto'): string {
    if (bytes.length < size) {
        throw new Error(`Insufficient bytes for ${size}-byte integer`);
    }
    let unsigned = 0;
    for (let i = 0; i < size; i++) {
        const byte = bytes[littleEndian ? size - 1 - i : i];
        unsigned = unsigned * 256 + byte;
    }
    if (radix === 16) {
        return `0x${unsigned.toString(16).toUpperCase().padStart(size * 2, '0')}`;
    }
    const max = 2 ** (size * 8);
    const value = signed && unsigned >= max / 2 ? unsigned - max : unsigned;
    return value.toString();
}

/**
 * バイト列を表示用の文字列にする
 * 16進は "0x" + 連結した16進数、10進は1バイトずつ空白区切り
 */
export function formatBytes(bytes: Uint8Array, radix: 10 | 16): string {
    if (radix === 10) {
        return Array.from(bytes).join(' ');
    }
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export class Int16LE implements BinaryInterpretType {
    toString(): string {
        return "Int16LE";
    }

    interpret(bytes: Uint8Array, options?: InterpretOptions): string {
        return formatInteger(bytes, 2, true, true, options?.radix);
    }
}

export class Int32LE implements BinaryInterpretType {
    toString(): string {
        return "Int32LE";
    }

    interpret(bytes: Uint8Array, options?: InterpretOptions): string {
        return formatInteger(bytes, 4, true, true, options?.radix);
    }
}


export class Int32LEHex implements BinaryInterpretType {
    toString(): string {
        return "Int32LE Hex";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 4) {
            throw new Error("Insufficient bytes for Int32LE");
        }
        const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
        return value.toString(16);
    }
}

// エンコーディング名の正規化ヘルパー
function getEncodingDisplayName(encoding: string): string {
    switch (encoding.toLowerCase()) {
        case "ascii": return "Ascii";
        case "sjis": return "ShiftJis";
        case "shift-jis": return "ShiftJis";
        case "utf-8": return "UTF-8";
        case "other": return "Binary";
        default: return encoding;
    }
}

function getTextDecoderEncoding(encoding: string): string | null {
    switch (encoding.toLowerCase()) {
        case "ascii": return "ascii";
        case "sjis": return "shift_jis";
        case "shift-jis": return "shift_jis";
        case "utf-8": return "utf-8";
        case "other": return null;
        default: return null;
    }
}

function decodeBytesOrBinary(bytes: Uint8Array, encoding: string): string {
    const decoderEncoding = getTextDecoderEncoding(encoding);
    if (decoderEncoding === null) {
        // バイナリ表示
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
    return new TextDecoder(decoderEncoding).decode(bytes);
}

export class CharEncoding implements BinaryInterpretType {
    private encoding: string;
    constructor(encoding: string) {
        this.encoding = encoding;
    }
    toString(): string {
        return getEncodingDisplayName(this.encoding);
    }
    interpret(bytes: Uint8Array): string {
        const decoded = decodeBytesOrBinary(bytes, this.encoding);
        // バイナリ表示の場合は不可視文字変換をスキップ
        if (getTextDecoderEncoding(this.encoding) === null) {
            return decoded;
        }
        // 不可視文字を可視化
        return decoded
            .replace(/ /g, "(half space)")
            .replace(/\t/g, "(tab)")
            .replace(/\r/g, "(CR)")
            .replace(/\n/g, "(LF)");
    }
}

export class TextEncoding implements BinaryInterpretType {
    private encoding: string;
    constructor(encoding: string) {
        this.encoding = encoding;
    }
    toString(): string {
        return getEncodingDisplayName(this.encoding);
    }
    interpret(bytes: Uint8Array): string {
        return decodeBytesOrBinary(bytes, this.encoding);
    }
}

export class BytesHexEncoding implements BinaryInterpretType {
    toString(): string {
        return "Bytes";
    }
    interpret(bytes: Uint8Array, options?: InterpretOptions): string {
        return formatBytes(bytes, options?.radix === 10 ? 10 : 16);
    }
}

export class ZipDate implements BinaryInterpretType {
    toString(): string {
        return "ZipDate";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 2) {
            throw new Error("Insufficient bytes for ZipDate");
        }
        const date = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true);
        const day = date & 0x1F;
        const month = (date >> 5) & 0x0F;
        const year = ((date >> 9) & 0x7F) + 1980;
        return `${year}-${month}-${day}`;
    }
}

export class ZipTime implements BinaryInterpretType {
    toString(): string {
        return "ZipTime";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 2) {
            throw new Error("Insufficient bytes for ZipTime");
        }
        const time = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true);
        const seconds = (time & 0x1F) * 2;
        const minutes = (time >> 5) & 0x3F;
        const hours = (time >> 11) & 0x1F;
        return `${hours}:${minutes}:${seconds}`;
    }
}


export class ZipSignature implements BinaryInterpretType {
    toString(): string {
        return "ZipSignature";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 4) {
            throw new Error("Insufficient bytes for ZipSignature");
        }
        const signature = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
        switch (signature) {
            case 0x04034B50:
                return "PK0304(local file)";
            case 0x08074B50:
                return "PK0708(data descriptor)";
            case 0x02014B50:
                return "PK0102(central directory)";
            case 0x06054B50:
                return "PK0506(end of central directory)";
            default:
                return signature.toString(16).toUpperCase();
        }
    }
}

export class ZipGeneralPurposeBitFlag implements BinaryInterpretType {
    toString(): string {
        return "ZipGeneralPurposeBitFlag";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 2) {
            throw new Error("Insufficient bytes for ZipGeneralPurposeBitFlag");
        }
        const flag = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true);
        const flagBinary = flag.toString(2).padStart(16, '0');
        const flags = [];
        if (flag & 0x0001) flags.push("Password protected");
        if (flag & 0x0002) flags.push("Compression option 1");
        if (flag & 0x0004) flags.push("Compression option 2");
        if (flag & 0x0008) flags.push("Data descriptor used");
        if (flag & 0x0010) flags.push("Enhanced deflation");
        if (flag & 0x0020) flags.push("Compressed patched data");
        if (flag & 0x0040) flags.push("Strong encryption");
        if (flag & 0x0800) flags.push("UTF-8 file names/comments");
        if (flag & 0x2000) flags.push("Central directory encryption");
        return `${flagBinary} (${flags.join(", ")})`;
    }
}