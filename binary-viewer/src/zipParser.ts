import { BinaryRange } from "./BinaryRange";
import { CharEncoding, Int16LE, Int32LE, Int32LEHex, ZipDate, ZipGeneralPurposeBitFlag, ZipSignature, ZipTime } from "./BinaryInterpretType";

// ZIP構造体のサイズ定数
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const DATA_DESCRIPTOR_SIZE = 16;

// Local File Header のオフセット定数
const LFH_GENERAL_PURPOSE_FLAG = 6;
const LFH_COMPRESSED_SIZE = 18;
const LFH_FILENAME_LENGTH = 26;
const LFH_EXTRA_FIELD_LENGTH = 28;

// Central Directory のオフセット定数
const CD_GENERAL_PURPOSE_FLAG = 8;
const CD_FILENAME_LENGTH = 28;
const CD_EXTRA_FIELD_LENGTH = 30;
const CD_COMMENT_LENGTH = 32;

// End of Central Directory のオフセット定数
const EOCD_COMMENT_LENGTH = 20;

// General Purpose Bit Flag
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8_ENCODING = 0x0800;

function readUInt16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
    // >>> 0 で符号なし32ビット整数に変換（2GB以上のファイル対応）
    return (
        (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>> 0
    );
}

// General Purpose Bit Flag のビット11でエンコーディングを判定
function getFileNameEncoding(generalPurposeBitFlag: number): string {
    return (generalPurposeBitFlag & FLAG_UTF8_ENCODING) ? "utf-8" : "sjis";
}

export class ZipParser {
    static parse(data: Uint8Array): BinaryRange {
        const subRanges: BinaryRange[] = [];
        let offset = 0;
        do {
            const signature = data.subarray(offset, offset + 4);
            let element: BinaryRange;
            if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x03 && signature[3] === 0x04) {
                // PK\x03\x04 - Local file header
                element = ZipParser.parseFileEntry(data, offset);
            } else if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x07 && signature[3] === 0x08) {
                // PK\x07\x08 - Data descriptor
                element = ZipParser.parseDataDescriptor(data, offset);
            } else if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x01 && signature[3] === 0x02) {
                // PK\x01\x02 - Central directory file header
                element = ZipParser.parseCentralDirectory(data, offset);
            } else if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x05 && signature[3] === 0x06) {
                // PK\x05\x06 - End of central directory record
                element = ZipParser.parseEndOfCentralDirectory(data, offset);
            } else {
                const sigHex = Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join(' ');
                throw new Error(`Unknown ZIP format at offset ${offset}: signature = ${sigHex}`);
            }
            subRanges.push(element);
            offset += element.data.length;
        } while (subRanges[subRanges.length - 1].name !== "EndOfCentralDirectory");

        return new BinaryRange(
            data,
            "ZipFile",
            null,
            subRanges
        );
    }

    private static parseDataDescriptor(entire: Uint8Array, offset: number): BinaryRange {
        const bytes = entire.subarray(offset);
        // Data Descriptorは12バイト（シグネチャなし）または16バイト（シグネチャあり）
        // シグネチャありの場合: PK\x07\x08 + CRC32(4) + CompressedSize(4) + UncompressedSize(4) = 16バイト
        if (bytes.length < DATA_DESCRIPTOR_SIZE) throw new Error("Data descriptor too short");

        const subRanges: BinaryRange[] = [
            new BinaryRange(entire.subarray(offset + 0, offset + 4), "Signature", new ZipSignature(), []),
            new BinaryRange(entire.subarray(offset + 4, offset + 8), "CRC32", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 8, offset + 12), "CompressedSize", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 12, offset + DATA_DESCRIPTOR_SIZE), "UncompressedSize", new Int32LE(), []),
        ];
        return new BinaryRange(
            entire.subarray(offset, offset + DATA_DESCRIPTOR_SIZE),
            "DataDescriptor",
            null,
            subRanges
        );
    }

    private static parseEndOfCentralDirectory(entire: Uint8Array, offset: number): BinaryRange {
        const bytes = entire.subarray(offset);
        if (bytes.length < END_OF_CENTRAL_DIRECTORY_SIZE) throw new Error("End of central directory entry too short");

        const commentLength = readUInt16LE(bytes, EOCD_COMMENT_LENGTH);

        if (bytes.length < END_OF_CENTRAL_DIRECTORY_SIZE + commentLength) throw new Error("End of central directory entry too short");

        const subRanges: BinaryRange[] = [
            new BinaryRange(entire.subarray(offset + 0, offset + 4), "Signature", new ZipSignature(), []),
            new BinaryRange(entire.subarray(offset + 4, offset + 6), "NumberOfThisDisk", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 6, offset + 8), "NumberOfTheDiskWithStart", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 8, offset + 10), "TotalEntriesOnThisDisk", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 10, offset + 12), "TotalEntries", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 12, offset + 16), "SizeOfCentralDirectory", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 16, offset + 20), "OffsetOfStartOfCentralDirectory", new Int32LEHex(), []),
            new BinaryRange(entire.subarray(offset + 20, offset + END_OF_CENTRAL_DIRECTORY_SIZE), "CommentLength", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + END_OF_CENTRAL_DIRECTORY_SIZE, offset + END_OF_CENTRAL_DIRECTORY_SIZE + commentLength), "Comment", new CharEncoding("sjis"), []),
        ];
        return new BinaryRange(
            entire.subarray(offset, offset + END_OF_CENTRAL_DIRECTORY_SIZE + commentLength),
            "EndOfCentralDirectory",
            null,
            subRanges
        );
    }

    private static parseCentralDirectory(entire: Uint8Array, offset: number): BinaryRange {
        const bytes = entire.subarray(offset);
        if (bytes.length < CENTRAL_DIRECTORY_HEADER_SIZE) throw new Error("Central directory entry too short");

        const generalPurposeBitFlag = readUInt16LE(bytes, CD_GENERAL_PURPOSE_FLAG);
        const nameLength = readUInt16LE(bytes, CD_FILENAME_LENGTH);
        const extraFieldLength = readUInt16LE(bytes, CD_EXTRA_FIELD_LENGTH);
        const commentLength = readUInt16LE(bytes, CD_COMMENT_LENGTH);
        const fileNameEncoding = getFileNameEncoding(generalPurposeBitFlag);

        const entireSize = CENTRAL_DIRECTORY_HEADER_SIZE + nameLength + extraFieldLength + commentLength;

        if (bytes.length < entireSize) throw new Error("Central directory entry too short");

        const subRanges: BinaryRange[] = [
            new BinaryRange(entire.subarray(offset + 0, offset + 4), "Signature", new ZipSignature(), []),
            new BinaryRange(entire.subarray(offset + 4, offset + 6), "VersionMadeBy", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 6, offset + 8), "VersionNeededToExtract", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 8, offset + 10), "GeneralPurposeBitFlag", new ZipGeneralPurposeBitFlag(), []),
            new BinaryRange(entire.subarray(offset + 10, offset + 12), "CompressionMethod", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 12, offset + 14), "LastModFileTime", new ZipTime(), []),
            new BinaryRange(entire.subarray(offset + 14, offset + 16), "LastModFileDate", new ZipDate(), []),
            new BinaryRange(entire.subarray(offset + 16, offset + 20), "CRC32", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 20, offset + 24), "CompressedSize", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 24, offset + 28), "UncompressedSize", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 28, offset + 30), "FileNameLength", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 30, offset + 32), "ExtraFieldLength", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 32, offset + 34), "FileCommentLength", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 34, offset + 36), "DiskNumberStart", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 36, offset + 38), "InternalFileAttributes", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 38, offset + 42), "ExternalFileAttributes", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 42, offset + 46), "RelativeOffsetOfLocalHeader", new Int32LEHex(), []),
            // 可変長フィールド
            new BinaryRange(entire.subarray(offset + 46, offset + 46 + nameLength), "FileName", new CharEncoding(fileNameEncoding), []),
            new BinaryRange(entire.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraFieldLength), "ExtraField", null, []),
            new BinaryRange(entire.subarray(offset + 46 + nameLength + extraFieldLength, offset + 46 + nameLength + extraFieldLength + commentLength), "FileComment", new CharEncoding(fileNameEncoding), []),
        ];

        return new BinaryRange(
            entire.subarray(offset, offset + entireSize),
            "CentralDirectory",
            null,
            subRanges
        );
    }

    private static parseFileEntry(entire: Uint8Array, offset: number): BinaryRange {
        const bytes = entire.subarray(offset);
        if (bytes.length < LOCAL_FILE_HEADER_SIZE) throw new Error("File entry too short");

        const generalPurposeBitFlag = readUInt16LE(bytes, LFH_GENERAL_PURPOSE_FLAG);
        const nameLength = readUInt16LE(bytes, LFH_FILENAME_LENGTH);
        const extraFieldLength = readUInt16LE(bytes, LFH_EXTRA_FIELD_LENGTH);
        let compressedSize = readUInt32LE(bytes, LFH_COMPRESSED_SIZE);

        // ビット3が立っている場合、CompressedSizeは0で、Data Descriptorに実際のサイズがある
        // Data Descriptorのシグネチャ(PK\x07\x08)を探す必要がある
        const hasDataDescriptor = (generalPurposeBitFlag & FLAG_DATA_DESCRIPTOR) !== 0;
        
        if (hasDataDescriptor && compressedSize === 0) {
            // Data Descriptorのシグネチャを探す
            const dataStart = offset + LOCAL_FILE_HEADER_SIZE + nameLength + extraFieldLength;
            let searchOffset = dataStart;
            while (searchOffset < entire.length - 4) {
                if (entire[searchOffset] === 0x50 && 
                    entire[searchOffset + 1] === 0x4B && 
                    entire[searchOffset + 2] === 0x07 && 
                    entire[searchOffset + 3] === 0x08) {
                    compressedSize = searchOffset - dataStart;
                    break;
                }
                // 次のPKシグネチャ(Central Directory等)も探す
                if (entire[searchOffset] === 0x50 && 
                    entire[searchOffset + 1] === 0x4B && 
                    (entire[searchOffset + 2] === 0x01 || entire[searchOffset + 2] === 0x03 || entire[searchOffset + 2] === 0x05)) {
                    // Data Descriptorなしでいきなり次の構造が来た場合
                    compressedSize = searchOffset - dataStart;
                    break;
                }
                searchOffset++;
            }
        }

        const entireSize = LOCAL_FILE_HEADER_SIZE + nameLength + extraFieldLength + compressedSize;

        if (bytes.length < entireSize) throw new Error("File entry too short");

        const fileNameEncoding = getFileNameEncoding(generalPurposeBitFlag);

        const subRanges: BinaryRange[] = [
            new BinaryRange(entire.subarray(offset + 0, offset + 4), "Signature", new ZipSignature(), [] ),
            new BinaryRange(entire.subarray(offset + 4, offset + 6), "Version", new Int16LE(), [] ),
            new BinaryRange(entire.subarray(offset + 6, offset + 8), "GeneralPurposeBitFlag", new ZipGeneralPurposeBitFlag(), [] ),
            new BinaryRange(entire.subarray(offset + 8, offset + 10), "CompressionMethod", new Int16LE(), [] ),
            new BinaryRange(entire.subarray(offset + 10, offset + 12), "LastModFileTime", new ZipTime(), [] ),
            new BinaryRange(entire.subarray(offset + 12, offset + 14), "LastModFileDate", new ZipDate(), [] ),
            new BinaryRange(entire.subarray(offset + 14, offset + 18), "CRC32", new Int32LE(), [] ),
            new BinaryRange(entire.subarray(offset + 18, offset + 22), "CompressedSize", new Int32LE(), [] ),
            new BinaryRange(entire.subarray(offset + 22, offset + 26), "UncompressedSize", new Int32LE(), [] ),
            new BinaryRange(entire.subarray(offset + 26, offset + 28), "FileNameLength", new Int16LE(), [] ),
            new BinaryRange(entire.subarray(offset + 28, offset + LOCAL_FILE_HEADER_SIZE), "ExtraFieldLength", new Int16LE(), [] ),
            new BinaryRange(entire.subarray(offset + LOCAL_FILE_HEADER_SIZE, offset + LOCAL_FILE_HEADER_SIZE + nameLength), "FileName", new CharEncoding(fileNameEncoding), [] ),
            new BinaryRange(entire.subarray(offset + LOCAL_FILE_HEADER_SIZE + nameLength, offset + LOCAL_FILE_HEADER_SIZE + nameLength + extraFieldLength), "ExtraField", null, [] ),
            new BinaryRange(entire.subarray(offset + LOCAL_FILE_HEADER_SIZE + nameLength + extraFieldLength, offset + entireSize), "Contents", null, [] )
        ];

        return new BinaryRange(
            entire.subarray(offset, offset + entireSize),
            "FileEntry",
            null,
            subRanges
        );
    }
}