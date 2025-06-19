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

export class Ascii implements BinaryInterpretType {
    toString(): string {
        return "Ascii";
    }

    interpret(bytes: Uint8Array): string {
        return new TextDecoder("ascii").decode(bytes);
    }
}

export class ShiftJis implements BinaryInterpretType {
    toString(): string {
        return "ShiftJis";
    }

    interpret(bytes: Uint8Array): string {
        return new TextDecoder("sjis").decode(bytes);
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