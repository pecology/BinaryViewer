export type BinaryRange = {
    data: Uint8Array;
    name: string;
    description: string;
    subRanges: BinaryRange[];
};