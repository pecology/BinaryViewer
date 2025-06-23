import { BinaryRange } from "./BinaryRange";
import { CharEncoding, TextEncoding } from "./BinaryInterpretType";

// 判別可能な文字コード
export type TextEncodingType = "ascii" | "shift-jis" | "utf-8" | "other";

function detectEncoding(data: Uint8Array): TextEncodingType {
    // BOM判定
    if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
        return "utf-8";
    }
    if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xFE) {
        return "other"; // UTF-16LE だが今回は other 扱い
    }
    if (data.length >= 2 && data[0] === 0xFE && data[1] === 0xFF) {
        return "other"; // UTF-16BE だが今回は other 扱い
    }
    // ASCII判定
    let isAscii = true;
    for (let i = 0; i < data.length; i++) {
        if (data[i] > 0x7F) {
            isAscii = false;
            break;
        }
    }
    if (isAscii) return "ascii";
    // UTF-8判定（自前実装）
    let i = 0;
    let isUtf8 = true;
    while (i < data.length) {
        const b = data[i];
        let bytesInChar = 0;
        if ((b & 0x80) === 0x00) {
            // 1バイト文字
            bytesInChar = 1;
        } else if ((b & 0xE0) === 0xC0) {
            // 2バイト文字
            if (i + 1 >= data.length || (data[i + 1] & 0xC0) !== 0x80) { isUtf8 = false; break; }
            // 過剰な0xC0,0xC1は不正
            if (b === 0xC0 || b === 0xC1) { isUtf8 = false; break; }
            bytesInChar = 2;
        } else if ((b & 0xF0) === 0xE0) {
            // 3バイト文字
            if (i + 2 >= data.length || (data[i + 1] & 0xC0) !== 0x80 || (data[i + 2] & 0xC0) !== 0x80) { isUtf8 = false; break; }
            bytesInChar = 3;
        } else if ((b & 0xF8) === 0xF0) {
            // 4バイト文字
            if (i + 3 >= data.length || (data[i + 1] & 0xC0) !== 0x80 || (data[i + 2] & 0xC0) !== 0x80 || (data[i + 3] & 0xC0) !== 0x80) { isUtf8 = false; break; }
            // 0xF5以上は不正
            if (b > 0xF4) { isUtf8 = false; break; }
            bytesInChar = 4;
        } else {
            isUtf8 = false;
            break;
        }
        i += bytesInChar;
    }
    if (isUtf8) return "utf-8";
    // Shift-JIS判定（厳密）
    let isSjis = true;
    i = 0;
    while (i < data.length) {
        const b1 = data[i];
        if ((b1 >= 0x00 && b1 <= 0x7F) || (b1 >= 0xA1 && b1 <= 0xDF)) {
            // 1バイト文字
            i += 1;
        } else if ((b1 >= 0x81 && b1 <= 0x9F) || (b1 >= 0xE0 && b1 <= 0xFC)) {
            // 2バイト文字
            if (i + 1 >= data.length) { isSjis = false; break; }
            const b2 = data[i + 1];
            if (!((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC))) { isSjis = false; break; }
            i += 2;
        } else {
            isSjis = false;
            break;
        }
    }
    if (isSjis) return "shift-jis";
    return "other";
}

export class TextParser {
    static parse(data: Uint8Array): BinaryRange {
        const encoding = detectEncoding(data);
        const charInterpreter = new CharEncoding(encoding);
        const subRanges: BinaryRange[] = [];
        let offset = 0;
        if (encoding === "utf-8" && data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
            subRanges.push(new BinaryRange(data.subarray(0, 3), "BOM", null, []));
            offset = 3;
        }
        // 行分割（バイト配列から直接）
        let lineNum = 1;
        while (offset < data.length) {
            const lineStart = offset;
            let lineEnd = offset;
            let lineBreakLen = 0;
            while (lineEnd < data.length) {
                if (data[lineEnd] === 0x0D) { // CR
                    if (data[lineEnd + 1] === 0x0A) { // CR+LF
                        lineBreakLen = 2;
                        break;
                    } else {
                        lineBreakLen = 1;
                        break;
                    }
                } else if (data[lineEnd] === 0x0A) { // LF
                    lineBreakLen = 1;
                    break;
                }
                lineEnd++;
            }
            // 行本体
            const lineBytes = data.subarray(lineStart, lineEnd);
            const charRanges: BinaryRange[] = [];
            let charOffset = 0;
            while (charOffset < lineBytes.length) {
                // 1文字分のバイト数を推定
                let charLen = 1;
                if (encoding === "ascii") {
                    charLen = 1;
                } else if (encoding === "shift-jis") {
                    // SJIS: 1バイト(0x00-0x7F,0xA1-0xDF) or 2バイト(0x81-0x9F,0xE0-0xFC)
                    const b = lineBytes[charOffset];
                    if ((0x81 <= b && b <= 0x9F) || (0xE0 <= b && b <= 0xFC)) {
                        charLen = 2;
                    } else {
                        charLen = 1;
                    }
                } else if (encoding === "utf-8") {
                    // UTF-8: 先頭バイトで長さ判定
                    const b = lineBytes[charOffset];
                    if (b < 0x80) charLen = 1;
                    else if ((b & 0xE0) === 0xC0) charLen = 2;
                    else if ((b & 0xF0) === 0xE0) charLen = 3;
                    else if ((b & 0xF8) === 0xF0) charLen = 4;
                } else {
                    charLen = 1;
                }
                charRanges.push(new BinaryRange(
                    lineBytes.subarray(charOffset, charOffset + charLen),
                    "Char",
                    charInterpreter,
                    []
                ));
                charOffset += charLen;
            }
            // 改行コード
            let lineBreakRange: BinaryRange | null = null;
            if (lineBreakLen > 0) {
                lineBreakRange = new BinaryRange(
                    data.subarray(lineEnd, lineEnd + lineBreakLen),
                    "LineBreak",
                    charInterpreter,
                    []
                );
            }
            // Line Range
            const lineSubRanges = lineBreakRange ? [...charRanges, lineBreakRange] : charRanges;
            subRanges.push(new BinaryRange(
                data.subarray(lineStart, lineEnd + lineBreakLen),
                `Line:${lineNum}`,
                new TextEncoding(encoding),
                lineSubRanges
            ));
            offset = lineEnd + lineBreakLen;
            lineNum++;
        }
        return new BinaryRange(
            data,
            `TextFile(${encoding})`,
            null,
            subRanges
        );
    }
}
