/**
 * 動的バイナリパーサー
 * Ksyスキーマに基づいてバイナリデータを解析し、BinaryRangeツリーを生成する
 */

import { BinaryRange } from '../BinaryRange';
import type { BinaryInterpretType } from '../BinaryInterpretType';
import type {
    KsySchema,
    KsyField,
    KsyType,
    Endian,
} from './KsySchema';
import {
    parsePrimitiveType,
    isUserDefinedType,
    isStringField,
    isContentsField,
    isArrayField,
    getRepeatExpr,
} from './KsySchema';
import { parseYaml } from './YamlParser';
import type { YamlObject, YamlValue } from './YamlParser';
import {
    readPrimitive,
    readString,
    readStringZ,
} from './primitives';

/**
 * パース結果
 */
export interface ParseResult {
    /** ルートのBinaryRange */
    root: BinaryRange;
    /** パースしたバイト数 */
    bytesRead: number;
    /** パース中のエラー（致命的でないもの） */
    warnings: string[];
}

/**
 * パースコンテキスト
 */
interface ParseContext {
    /** データビュー */
    dataView: DataView;
    /** 現在のオフセット */
    offset: number;
    /** デフォルトエンディアン */
    defaultEndian?: Endian;
    /** デフォルトエンコーディング */
    defaultEncoding: string;
    /** スキーマ（ユーザー定義型参照用） */
    schema: KsySchema;
    /** 
     * 現在のスコープで解析済みのフィールド値
     * 
     * 後続フィールドの式（size, repeat-expr等）で前のフィールドの値を参照するために使用。
     * 例: `size: name_length` → values['name_length'] から値を取得
     * 
     * ユーザー定義型をパースする際は新しいスコープを作成し、
     * パース完了後に親スコープに復元する。
     */
    values: Record<string, number | string | Uint8Array | unknown[]>;
    /** 警告メッセージ */
    warnings: string[];
    /** 元のArrayBuffer */
    buffer: ArrayBuffer;
}

/**
 * YAMLテキストからKsyスキーマをパース
 */
export function parseKsySchema(yamlText: string): KsySchema {
    const obj = parseYaml(yamlText) as YamlObject;
    return convertToKsySchema(obj);
}

/**
 * YamlObjectをKsySchemaに変換
 */
function convertToKsySchema(obj: YamlObject): KsySchema {
    const meta = obj['meta'] as YamlObject | undefined;
    if (!meta || typeof meta !== 'object') {
        throw new Error('meta section is required');
    }

    const metaId = meta['id'];
    if (typeof metaId !== 'string') {
        throw new Error('meta.id is required and must be a string');
    }

    const seq = obj['seq'];
    if (!Array.isArray(seq)) {
        throw new Error('seq section is required and must be an array');
    }

    const schema: KsySchema = {
        meta: {
            id: metaId,
            endian: parseEndian(meta['endian']),
            encoding: typeof meta['encoding'] === 'string' ? meta['encoding'] : undefined,
            fileExtension: meta['file-extension'] as string | string[] | undefined,
        },
        seq: seq.map(convertToKsyField),
        doc: typeof obj['doc'] === 'string' ? obj['doc'] : undefined,
    };

    // ユーザー定義型
    const types = obj['types'];
    if (types && typeof types === 'object') {
        schema.types = {};
        for (const [name, typeDef] of Object.entries(types as YamlObject)) {
            schema.types[name] = convertToKsyType(typeDef as YamlObject);
        }
    }

    return schema;
}

function parseEndian(value: YamlValue): Endian | undefined {
    if (value === 'le' || value === 'be') {
        return value;
    }
    return undefined;
}

function convertToKsyField(obj: YamlValue): KsyField {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        throw new Error('Field must be an object');
    }

    const fieldObj = obj as YamlObject;
    const id = fieldObj['id'];
    const type = fieldObj['type'];

    if (typeof id !== 'string') {
        throw new Error('Field id is required');
    }
    if (typeof type !== 'string') {
        throw new Error(`Field type is required for field "${id}"`);
    }

    // 共通フィールド
    const doc = typeof fieldObj['doc'] === 'string' ? fieldObj['doc'] : undefined;
    
    // 繰り返し設定
    const repeat = fieldObj['repeat'];
    const repeatExpr = fieldObj['repeat-expr'];
    const hasRepeat = repeat === 'expr' && (typeof repeatExpr === 'number' || typeof repeatExpr === 'string');
    
    // contents設定
    const contents = fieldObj['contents'];
    const hasContents = Array.isArray(contents);
    
    // 文字列型判定
    const isStr = type === 'str' || type === 'strz';
    
    // size, encoding
    const size = fieldObj['size'];
    const encoding = fieldObj['encoding'];

    // 適切な型を構築して返す
    if (hasContents) {
        // ContentsField
        const contentsArray = contents.filter((v): v is number => typeof v === 'number');
        if (hasRepeat) {
            return {
                id,
                type,
                contents: contentsArray,
                repeat: 'expr' as const,
                repeatExpr: repeatExpr as number | string,
                doc,
            };
        }
        return { id, type, contents: contentsArray, doc };
    }

    if (isStr) {
        // StringField
        const strField: KsyField = hasRepeat
            ? {
                id,
                type: type as 'str' | 'strz',
                size: typeof size === 'number' || typeof size === 'string' ? size : undefined,
                encoding: typeof encoding === 'string' ? encoding : undefined,
                repeat: 'expr' as const,
                repeatExpr: repeatExpr as number | string,
                doc,
            }
            : {
                id,
                type: type as 'str' | 'strz',
                size: typeof size === 'number' || typeof size === 'string' ? size : undefined,
                encoding: typeof encoding === 'string' ? encoding : undefined,
                doc,
            };
        return strField;
    }

    // PrimitiveField または UserTypeField
    if (hasRepeat) {
        return {
            id,
            type,
            repeat: 'expr' as const,
            repeatExpr: repeatExpr as number | string,
            doc,
        };
    }
    return { id, type, doc };
}

function convertToKsyType(obj: YamlObject): KsyType {
    const seq = obj['seq'];
    if (!Array.isArray(seq)) {
        throw new Error('Type seq is required and must be an array');
    }

    return {
        seq: seq.map(convertToKsyField),
        doc: typeof obj['doc'] === 'string' ? obj['doc'] : undefined,
    };
}

/**
 * バイナリデータをKsyスキーマに基づいてパース
 */
export function parseBinary(data: ArrayBuffer, schema: KsySchema): ParseResult {
    const dataView = new DataView(data);
    const context: ParseContext = {
        dataView,
        offset: 0,
        defaultEndian: schema.meta.endian,
        defaultEncoding: schema.meta.encoding ?? 'utf-8',
        schema,
        values: {},
        warnings: [],
        buffer: data,
    };

    const rootRanges: BinaryRange[] = [];
    
    for (const field of schema.seq) {
        const fieldRanges = parseField(context, field);
        for (const range of fieldRanges) {
            rootRanges.push(range);
        }
    }

    // ルートノードを作成（全体を包含するデータ）
    const rootData = new Uint8Array(data, 0, context.offset);
    const root = new BinaryRange(rootData, schema.meta.id, null, rootRanges);

    return {
        root,
        bytesRead: context.offset,
        warnings: context.warnings,
    };
}

/**
 * フィールドをパースしてBinaryRangeを返す
 */
function parseField(context: ParseContext, field: KsyField): BinaryRange[] {
    // 繰り返し処理（配列フィールド）
    if (isArrayField(field)) {
        const repeatExpr = getRepeatExpr(field);
        if (repeatExpr === undefined) {
            throw new Error(`Field "${field.id}": repeat-expr is required for array field`);
        }
        const count = resolveExpr(context, repeatExpr);
        const ranges: BinaryRange[] = [];
        const arrayValues: unknown[] = [];

        for (let i = 0; i < count; i++) {
            const [range, value] = parseSingleField(context, field, `${field.id}[${i}]`);
            ranges.push(range);
            arrayValues.push(value);
        }

        context.values[field.id] = arrayValues;
        return ranges;
    }

    // 単一フィールド
    const [range, value] = parseSingleField(context, field, field.id);
    context.values[field.id] = value as number | string | Uint8Array;
    return [range];
}

/**
 * 単一のフィールドをパース
 * @returns [BinaryRange, 解析した値]
 */
function parseSingleField(
    context: ParseContext,
    field: KsyField,
    displayName: string
): [BinaryRange, unknown] {
    const startOffset = context.offset;
    const typeName = field.type;

    // プリミティブ型チェック
    const primitiveInfo = parsePrimitiveType(typeName, context.defaultEndian);
    if (primitiveInfo) {
        const value = readPrimitive(context.dataView, context.offset, primitiveInfo);
        context.offset += primitiveInfo.size;

        const data = new Uint8Array(context.buffer, startOffset, primitiveInfo.size);
        const interpretType = createInterpretType(typeName, primitiveInfo.size, primitiveInfo.signed);
        const range = new BinaryRange(data, displayName, interpretType);
        
        // contents検証（型ガードを使用）
        if (isContentsField(field)) {
            if (!arraysEqual(data, new Uint8Array(field.contents))) {
                context.warnings.push(
                    `Field "${displayName}": expected contents [${field.contents.join(', ')}] but got [${Array.from(data).join(', ')}]`
                );
            }
        }

        return [range, value];
    }

    // 文字列型（型ガードを使用）
    if (isStringField(field)) {
        const encoding = field.encoding ?? context.defaultEncoding;

        if (field.type === 'strz') {
            const maxSize = field.size !== undefined ? resolveExpr(context, field.size) : undefined;
            const [value, bytesRead] = readStringZ(context.dataView, context.offset, maxSize, encoding);
            context.offset += bytesRead;

            const data = new Uint8Array(context.buffer, startOffset, bytesRead);
            const interpretType = createStringInterpretType(encoding);
            const range = new BinaryRange(data, displayName, interpretType);
            return [range, value];
        } else {
            // str
            if (field.size === undefined) {
                throw new Error(`Field "${displayName}": str type requires size`);
            }
            const size = resolveExpr(context, field.size);
            const value = readString(context.dataView, context.offset, size, encoding);
            context.offset += size;

            const data = new Uint8Array(context.buffer, startOffset, size);
            const interpretType = createStringInterpretType(encoding);
            const range = new BinaryRange(data, displayName, interpretType);
            return [range, value];
        }
    }

    // ユーザー定義型
    if (isUserDefinedType(typeName, context.schema)) {
        const userType = context.schema.types![typeName];
        return parseUserType(context, userType, displayName);
    }

    throw new Error(`Unknown type: ${typeName}`);
}

/**
 * ユーザー定義型をパース
 */
function parseUserType(
    context: ParseContext,
    userType: KsyType,
    displayName: string
): [BinaryRange, Record<string, unknown>] {
    const startOffset = context.offset;
    
    // ユーザー定義型用のローカルスコープを作成
    const savedValues = context.values;
    context.values = {};
    
    const result: Record<string, unknown> = {};
    const subRanges: BinaryRange[] = [];

    for (const field of userType.seq) {
        const fieldRanges = parseField(context, field);
        for (const r of fieldRanges) {
            subRanges.push(r);
        }
        result[field.id] = context.values[field.id];
    }

    const length = context.offset - startOffset;
    const data = new Uint8Array(context.buffer, startOffset, length);
    const range = new BinaryRange(data, displayName, null, subRanges);
    
    // スコープを復元
    context.values = savedValues;

    return [range, result];
}

/**
 * 式を評価（フィールド参照または数値リテラル）
 */
function resolveExpr(context: ParseContext, expr: number | string): number {
    if (typeof expr === 'number') {
        return expr;
    }

    // フィールド参照
    const value = context.values[expr];
    if (typeof value === 'number') {
        return value;
    }

    throw new Error(`Cannot resolve expression "${expr}": not a number`);
}

/**
 * 配列が等しいかチェック
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * プリミティブ型のInterpretTypeを作成
 */
function createInterpretType(typeName: string, size: number, signed: boolean): BinaryInterpretType {
    // 型名から表示用の名前を生成
    const displayName = typeName.toUpperCase();
    
    return {
        toString: () => displayName,
        interpret: (bytes: Uint8Array) => {
            const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
            const littleEndian = typeName.endsWith('le') || 
                (!typeName.endsWith('be') && size <= 1);
            
            let value: number;
            if (signed) {
                switch (size) {
                    case 1: value = dataView.getInt8(0); break;
                    case 2: value = dataView.getInt16(0, littleEndian); break;
                    case 4: value = dataView.getInt32(0, littleEndian); break;
                    default: value = 0;
                }
            } else {
                switch (size) {
                    case 1: value = dataView.getUint8(0); break;
                    case 2: value = dataView.getUint16(0, littleEndian); break;
                    case 4: value = dataView.getUint32(0, littleEndian); break;
                    default: value = 0;
                }
            }

            return value.toString();
        },
    };
}

/**
 * 文字列型のInterpretTypeを作成
 */
function createStringInterpretType(encoding: string): BinaryInterpretType {
    return {
        toString: () => `String(${encoding})`,
        interpret: (bytes: Uint8Array) => {
            // null終端を除去
            let endIndex = bytes.length;
            for (let i = 0; i < bytes.length; i++) {
                if (bytes[i] === 0) {
                    endIndex = i;
                    break;
                }
            }
            const actualBytes = bytes.subarray(0, endIndex);
            
            try {
                const decoder = new TextDecoder(encoding);
                return `"${decoder.decode(actualBytes)}"`;
            } catch {
                return `[${Array.from(actualBytes).join(', ')}]`;
            }
        },
    };
}
