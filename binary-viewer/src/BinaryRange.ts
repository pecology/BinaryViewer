export class BinaryRange {
    data: Uint8Array;
    name: string;
    description: string;
    subRanges: BinaryRange[];

    constructor(data: Uint8Array, name: string, description: string, subRanges: BinaryRange[] = []) {
        this.data = data;
        this.name = name;
        this.description = description;
        this.subRanges = subRanges;
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

