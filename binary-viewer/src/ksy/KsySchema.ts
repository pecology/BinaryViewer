/**
 * Ksy Schema 型定義
 * Kaitai Struct (.ksy) ファイルの構造を表す型
 */

/** エンディアン */
export type Endian = 'le' | 'be';

/** メタ情報 */
export interface KsyMeta {
    /** スキーマID */
    id: string;
    /** デフォルトエンディアン */
    endian?: Endian;
    /** 対応するファイル拡張子 */
    fileExtension?: string | string[];
    /** デフォルト文字列エンコーディング */
    encoding?: string;
}

/** 繰り返しの種類 */
export type RepeatType = 'expr';

/** フィールド定義 */
export interface KsyField {
    /** フィールドID（名前） */
    id: string;
    /** 型名 (u1, u2, u3, u4, s1, s2, s3, s4, str, strz, またはユーザー定義型) */
    type: string;
    /** サイズ（str型などで使用、数値またはフィールド参照） */
    size?: number | string;
    /** 文字列エンコーディング */
    encoding?: string;
    /** 繰り返しの種類 */
    repeat?: RepeatType;
    /** 繰り返し回数（フィールド参照または数値） */
    repeatExpr?: number | string;
    /** 期待するバイト列（マジックナンバー検証用） */
    contents?: number[];
    /** ドキュメント（説明） */
    doc?: string;
}

/** ユーザー定義型 */
export interface KsyType {
    /** フィールドのシーケンス */
    seq: KsyField[];
    /** ドキュメント（説明） */
    doc?: string;
}

/** Ksyスキーマ全体 */
export interface KsySchema {
    /** メタ情報 */
    meta: KsyMeta;
    /** ルートレベルのフィールドシーケンス */
    seq: KsyField[];
    /** ユーザー定義型 */
    types?: Record<string, KsyType>;
    /** ドキュメント（説明） */
    doc?: string;
}

/**
 * 基本型の情報
 */
export interface PrimitiveTypeInfo {
    /** バイトサイズ */
    size: number;
    /** 符号あり */
    signed: boolean;
    /** エンディアン（1バイトの場合はundefined） */
    endian?: Endian;
}

/**
 * 基本型名をパースして情報を取得
 * @param typeName 型名 (例: "u2", "u4le", "s2be")
 * @param defaultEndian デフォルトエンディアン
 * @returns 型情報、または基本型でない場合はnull
 */
export function parsePrimitiveType(typeName: string, defaultEndian?: Endian): PrimitiveTypeInfo | null {
    // パターン: (u|s)(1|2|3|4)(le|be)?
    const match = typeName.match(/^([us])([1-4])(le|be)?$/);
    if (!match) {
        return null;
    }

    const [, signChar, sizeStr, endianStr] = match;
    const size = parseInt(sizeStr, 10);
    const signed = signChar === 's';

    // 1バイトの場合はエンディアン不要
    let endian: Endian | undefined;
    if (size > 1) {
        if (endianStr) {
            endian = endianStr as Endian;
        } else if (defaultEndian) {
            endian = defaultEndian;
        } else {
            throw new Error(`Endian must be specified for type "${typeName}" (no default endian set)`);
        }
    }

    return { size, signed, endian };
}

/**
 * 文字列型かどうか判定
 */
export function isStringType(typeName: string): boolean {
    return typeName === 'str' || typeName === 'strz';
}

/**
 * ユーザー定義型かどうか判定
 */
export function isUserDefinedType(typeName: string, schema: KsySchema): boolean {
    return schema.types !== undefined && typeName in schema.types;
}
