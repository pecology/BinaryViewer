import { BinaryRange } from "./BinaryRange";
import { Ascii, Int16LE, Int32LE, Int32LEHex, ShiftJis, ZipDate, ZipGeneralPurposeBitFlag, ZipSignature, ZipTime } from "./BinaryInterpretType";


function readUInt16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
    );
}

export class ZipParser {
    static parse(data: Uint8Array): BinaryRange {
        const subRanges: BinaryRange[] = [];
        let offset = 0;
        do {
            const signature = data.subarray(offset, offset + 4);
            let element: BinaryRange;
            if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x03 && signature[3] === 0x04) {
                element = ZipParser.parseFileEntry(data, offset);
            } else if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x01 && signature[3] === 0x02) {
                element = ZipParser.parseCentralDirectory(data, offset);
            } else if (signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x05 && signature[3] === 0x06) {
                element = ZipParser.parseEndOfCentralDirectory(data, offset);
            } else {
                throw new Error("Unknown ZIP format");
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

    private static parseEndOfCentralDirectory(entire: Uint8Array, offset: number): BinaryRange {
        const bytes = entire.subarray(offset);
        if (bytes.length < 22) throw new Error("End of central directory entry too short");

        const commentLength = readUInt16LE(bytes, 20);

        if (bytes.length < 22 + commentLength) throw new Error("End of central directory entry too short");

        const subRanges: BinaryRange[] = [
            new BinaryRange(entire.subarray(offset + 0, offset + 4), "Signature", new ZipSignature(), []),
            new BinaryRange(entire.subarray(offset + 4, offset + 6), "NumberOfThisDisk", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 6, offset + 8), "NumberOfTheDiskWithStart", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 8, offset + 10), "TotalEntriesOnThisDisk", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 10, offset + 12), "TotalEntries", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 12, offset + 16), "SizeOfCentralDirectory", new Int32LE(), []),
            new BinaryRange(entire.subarray(offset + 16, offset + 20), "OffsetOfStartOfCentralDirectory", new Int32LEHex(), []),
            new BinaryRange(entire.subarray(offset + 20, offset + 22), "CommentLength", new Int16LE(), []),
            new BinaryRange(entire.subarray(offset + 22, offset + 22 + commentLength), "Comment", new ShiftJis(), []),
        ];
        return new BinaryRange(
            entire.subarray(offset, offset + 22 + commentLength),
            "EndOfCentralDirectory",
            null,
            subRanges
        );
    }

    private static parseCentralDirectory(entire: Uint8Array, offset: number): BinaryRange {
        const bytes = entire.subarray(offset);
        if (bytes.length < 46) throw new Error("Central directory entry too short");

        const nameLength = readUInt16LE(bytes, 28);
        const extraFieldLength = readUInt16LE(bytes, 30);
        const commentLength = readUInt16LE(bytes, 32);

        const entireSize = 46 + nameLength + extraFieldLength + commentLength;

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
            new BinaryRange(entire.subarray(offset + 46, offset + 46 + nameLength), "FileName", new ShiftJis(), []),
            new BinaryRange(entire.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraFieldLength), "ExtraField", null, []),
            new BinaryRange(entire.subarray(offset + 46 + nameLength + extraFieldLength, offset + 46 + nameLength + extraFieldLength + commentLength), "FileComment", null, []),
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
        if (bytes.length < 30) throw new Error("File entry too short");

        const nameLength = readUInt16LE(bytes, 26);
        const extraFieldLength = readUInt16LE(bytes, 28);
        const compressedSize = readUInt32LE(bytes, 18);

        const entireSize = 30 + nameLength + extraFieldLength + compressedSize;

        if (bytes.length < entireSize) throw new Error("File entry too short");

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
            new BinaryRange(entire.subarray(offset + 28, offset + 30), "ExtraFieldLength", new Int16LE(), [] ),
            new BinaryRange(entire.subarray(offset + 30, offset + 30 + nameLength), "FileName", new ShiftJis(), [] ),
            new BinaryRange(entire.subarray(offset + 30 + nameLength, offset + 30 + nameLength + extraFieldLength), "ExtraField", null, [] ),
            new BinaryRange(entire.subarray(offset + 30 + nameLength + extraFieldLength, offset + entireSize), "Contents", null, [] )
        ];

        return new BinaryRange(
            entire.subarray(offset, offset + entireSize),
            "FileEntry",
            null,
            subRanges
        );
    }
}