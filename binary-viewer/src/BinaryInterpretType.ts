export interface BinaryInterpretType {
    toString(): string;
    interpret(bytes: Uint8Array): string;
}

export class Int16LE implements BinaryInterpretType {
    toString(): string {
        return "Int16LE";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 2) {
            throw new Error("Insufficient bytes for Int16LE");
        }
        const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(0, true);
        return value.toString();
    }
}

export class Int32LE implements BinaryInterpretType {
    toString(): string {
        return "Int32LE";
    }

    interpret(bytes: Uint8Array): string {
        if (bytes.length < 4) {
            throw new Error("Insufficient bytes for Int32LE");
        }
        const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
        return value.toString();
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