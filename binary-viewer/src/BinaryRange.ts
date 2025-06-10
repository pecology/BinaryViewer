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

    contains(index: number): boolean;

    contains(startindex: number, endIndex: number = startindex): boolean {
        return startindex <= endIndex &&
               startindex >= this.data.byteOffset && 
               endIndex <= this.data.byteOffset + this.data.length;
    }
}

// 使用例
const binaryRange = new BinaryRange(new Uint8Array([1, 2, 3, 4, 5]), "Example", "An example binary range");
console.log(binaryRange.contains(3)); // true
console.log(binaryRange.contains(10)); // false
