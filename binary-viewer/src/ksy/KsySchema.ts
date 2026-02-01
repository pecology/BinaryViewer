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

// ============================================
// フィールド型定義（Union型による型安全な設計）
// ============================================

/** 全フィールド共通の基本プロパティ */
interface KsyFieldBase {
    /** フィールドID（名前） */
    id: string;
    /** ドキュメント（説明） */
    doc?: string;
}

/** 繰り返し設定（配列フィールド用） */
interface WithRepeat {
    /** 繰り返しの種類 */
    repeat: RepeatType;
    /** 繰り返し回数（フィールド参照または数値） */
    repeatExpr: number | string;
}

/**
 * 固定バイト列フィールド（マジックナンバー等）
 * contents が必須、type は不要
 */
export interface KsyContentsField extends KsyFieldBase {
    /** 型名（プリミティブ型で読み取り、contentsと比較） */
    type: string;
    /** 期待するバイト列 */
    contents: number[];
}

/**
 * 固定バイト列フィールド（配列版）
 */
export interface KsyContentsArrayField extends KsyContentsField, WithRepeat {}

/**
 * 文字列型フィールド（str, strz）
 * size が必須（strz の場合は最大サイズとして使用、省略可能な場合もある）
 */
export interface KsyStringField extends KsyFieldBase {
    /** 型名 ('str' または 'strz') */
    type: 'str' | 'strz';
    /** サイズ（数値またはフィールド参照） */
    size?: number | string;
    /** 文字列エンコーディング */
    encoding?: string;
}

/**
 * 文字列型フィールド（配列版）
 */
export interface KsyStringArrayField extends KsyStringField, WithRepeat {}

/**
 * プリミティブ型フィールド（u1, u2, s4など）
 */
export interface KsyPrimitiveField extends KsyFieldBase {
    /** 型名 (u1, u2, u3, u4, s1, s2, s3, s4, u2le, u4be など) */
    type: string;
}

/**
 * プリミティブ型フィールド（配列版）
 */
export interface KsyPrimitiveArrayField extends KsyPrimitiveField, WithRepeat {}

/**
 * ユーザー定義型フィールド
 */
export interface KsyUserTypeField extends KsyFieldBase {
    /** ユーザー定義型名 */
    type: string;
}

/**
 * ユーザー定義型フィールド（配列版）
 */
export interface KsyUserTypeArrayField extends KsyUserTypeField, WithRepeat {}

/**
 * フィールド定義（Union型）
 * 
 * 注意: KsyPrimitiveField と KsyUserTypeField は構造上同じだが、
 * 実行時にスキーマの types を参照して区別する
 */
export type KsyField =
    | KsyContentsField
    | KsyContentsArrayField
    | KsyStringField
    | KsyStringArrayField
    | KsyPrimitiveField
    | KsyPrimitiveArrayField
    | KsyUserTypeField
    | KsyUserTypeArrayField;

// ============================================
// 型ガード関数
// ============================================

/** contentsフィールドかどうか */
export function isContentsField(field: KsyField): field is KsyContentsField | KsyContentsArrayField {
    return 'contents' in field && Array.isArray(field.contents);
}

/** 文字列型フィールドかどうか */
export function isStringField(field: KsyField): field is KsyStringField | KsyStringArrayField {
    return field.type === 'str' || field.type === 'strz';
}

/** 配列フィールドかどうか */
export function isArrayField(field: KsyField): field is KsyContentsArrayField | KsyStringArrayField | KsyPrimitiveArrayField | KsyUserTypeArrayField {
    return 'repeat' in field && field.repeat !== undefined;
}

/** 繰り返し回数を取得（配列フィールドの場合） */
export function getRepeatExpr(field: KsyField): number | string | undefined {
    if (isArrayField(field)) {
        return field.repeatExpr;
    }
    return undefined;
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
