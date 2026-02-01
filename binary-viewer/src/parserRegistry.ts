/**
 * パーサーレジストリ
 * 
 * 組み込みパーサーを一元管理し、新しいパーサーを追加する際の
 * 修正箇所を最小限に抑える。
 * 
 * 新しいパーサーを追加するには：
 * 1. パーサークラスを作成（BinaryParserインターフェースを実装）
 * 2. このファイルでimportしてbuiltinParsersに追加
 */

import type { BinaryRange } from './BinaryRange.ts';
import { ZipParser } from './zipParser.ts';
import { TextParser } from './textParser.ts';

/**
 * バイナリパーサーのインターフェース
 */
export interface BinaryParser {
    /** パーサーの識別子（URL-safe、小文字推奨） */
    readonly id: string;
    /** 表示名 */
    readonly name: string;
    /** パース処理 */
    parse(data: Uint8Array): BinaryRange;
}

/**
 * 組み込みパーサーの一覧
 * 
 * 新しいパーサーを追加する場合はここに追加する
 */
const builtinParsers: BinaryParser[] = [
    {
        id: 'zip',
        name: 'ZIP Parser',
        parse: (data) => ZipParser.parse(data),
    },
    {
        id: 'text',
        name: 'Text Parser',
        parse: (data) => TextParser.parse(data),
    },
];

/**
 * 組み込みパーサーの一覧を取得
 */
export function getBuiltinParsers(): readonly BinaryParser[] {
    return builtinParsers;
}

/**
 * IDから組み込みパーサーを取得
 */
export function getBuiltinParser(id: string): BinaryParser | undefined {
    return builtinParsers.find(p => p.id === id);
}

/**
 * パーサーIDが組み込みパーサーかどうか
 */
export function isBuiltinParser(id: string): boolean {
    return builtinParsers.some(p => p.id === id);
}
