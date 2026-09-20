import type { BinaryInterpretType } from "./BinaryInterpretType";

export class BinaryRange {
    data: Uint8Array;
    name: string;
    binaryInterpretType: BinaryInterpretType | null;
    subRanges: BinaryRange[];
    doc?: string;

    constructor(data: Uint8Array, name: string, binaryInterpretType: BinaryInterpretType | null, subRanges: BinaryRange[] = [], doc?: string) {
        this.data = data;
        this.name = name;
        this.binaryInterpretType = binaryInterpretType;
        this.subRanges = subRanges;
        this.doc = doc;
    }

    interpret() {
        if (this.binaryInterpretType === null)
        {
            return "";
        } else
        {
            return `${this.binaryInterpretType.interpret(this.data)} (${this.binaryInterpretType.toString()})`;
        }
    }

    contains(offset: number): boolean;
    contains(offset: number, length: number): boolean;

    contains(offset: number, length: number = 1): boolean {
        if (length < 1) {
            return false;
        }

        if (this.data.length === 0) {
            return false;
        }

        return offset >= this.data.byteOffset && 
               offset + length <= this.data.byteOffset + this.data.length;
    }
}

