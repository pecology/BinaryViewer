/**
 * 動的バイナリパーサー
 * Ksyスキーマに基づいてバイナリデータを解析し、BinaryRangeツリーを生成する
 */

import { BinaryRange } from '../BinaryRange';
import { loadKsy } from '../ksyStorage';
import type { BinaryInterpretType } from '../BinaryInterpretType';
import { HexEncoding } from '../BinaryInterpretType';
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
    isBytesField,
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
 * テキスト（YAMLまたはJSON）からKsyスキーマをパース
 * JSONの場合は先にパースを試み、失敗したらYAMLとしてパース
 */
export function parseKsySchema(text: string): KsySchema {
    const trimmed = text.trim();
    
    // JSONかどうかを判定（{で始まる場合）
    if (trimmed.startsWith('{')) {
        try {
            const obj = JSON.parse(trimmed);
            return convertToKsySchema(obj);
        } catch {
            // JSONパースに失敗した場合はYAMLとして試行
        }
    }
    
    // YAMLとしてパース
    const obj = parseYaml(text) as YamlObject;
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
            category: typeof meta['category'] === 'string' ? meta['category'] : undefined,
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
    
    // 文字列型・hex型判定
    const isStr = type === 'str' || type === 'strz' || type === 'hex';
    const isBytes = type === 'bytes';
    
    // size, encoding
    const size = fieldObj['size'];
    const encoding = fieldObj['encoding'];

    // 条件式（if）
    const ifExpr = fieldObj['if'] !== undefined ? String(fieldObj['if']) : undefined;
    const consume = fieldObj['consume'];

    let result: KsyField;

    // 適切な型を構築して返す
    if (hasContents) {
        // ContentsField
        const contentsArray = contents.filter((v): v is number => typeof v === 'number');
        if (hasRepeat) {
            result = {
                id,
                type,
                contents: contentsArray,
                repeat: 'expr' as const,
                repeatExpr: repeatExpr as number | string,
                doc,
            };
        } else {
            result = { id, type, contents: contentsArray, doc };
        }
    } else if (isStr) {
        // StringField / HexField
        if (hasRepeat) {
            result = {
                id,
                type: type as 'str' | 'strz' | 'hex',
                size: typeof size === 'number' || typeof size === 'string' ? size : undefined,
                encoding: typeof encoding === 'string' ? encoding : undefined,
                repeat: 'expr' as const,
                repeatExpr: repeatExpr as number | string,
                doc,
            };
        } else {
            result = {
                id,
                type: type as 'str' | 'strz' | 'hex',
                size: typeof size === 'number' || typeof size === 'string' ? size : undefined,
                encoding: typeof encoding === 'string' ? encoding : undefined,
                doc,
            };
        }
    } else if (isBytes) {
        if (typeof size !== 'number' && typeof size !== 'string') {
            throw new Error(`Field "${id}": bytes type requires size`);
        }
        if (hasRepeat) {
            result = {
                id,
                type: 'bytes',
                size,
                repeat: 'expr' as const,
                repeatExpr: repeatExpr as number | string,
                doc,
            };
        } else {
            result = { id, type: 'bytes', size, doc };
        }
    } else {
        // PrimitiveField または UserTypeField
        if (hasRepeat) {
            result = {
                id,
                type,
                repeat: 'expr' as const,
                repeatExpr: repeatExpr as number | string,
                doc,
            };
        } else {
            result = { id, type, doc };
        }
    }

    if (ifExpr !== undefined) {
        (result as any).if = ifExpr;
    }
    if (consume !== undefined) {
        (result as any).consume = Boolean(consume);
    }

    return result;
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
    const root = new BinaryRange(rootData, schema.meta.id, null, rootRanges, schema.doc);

    return {
        root,
        bytesRead: context.offset,
        warnings: context.warnings,
    };
}

/**
 * フィールドをパースしてBinaryRangeを返す
 */
function parseField(context: ParseContext, field: KsyField & { if?: string }): BinaryRange[] {
    if (field.if && !evaluateCondition(context, field.if)) {
        return [];
    }

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
        return field.consume === false ? [] : ranges;
    }

    // 単一フィールド
    const [range, value] = parseSingleField(context, field, field.id);
    context.values[field.id] = value as number | string | Uint8Array;
    return field.consume === false ? [] : [range];
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
    const shouldConsume = field.consume !== false;

    // プリミティブ型チェック
    const primitiveInfo = parsePrimitiveType(typeName, context.defaultEndian);
    if (primitiveInfo) {
        const value = readPrimitive(context.dataView, context.offset, primitiveInfo);
        if (shouldConsume) {
            context.offset += primitiveInfo.size;
        }

        const data = new Uint8Array(context.buffer, startOffset, primitiveInfo.size);
        const interpretType = createInterpretType(typeName, primitiveInfo.size, primitiveInfo.signed);
        const range = new BinaryRange(data, displayName, interpretType, [], field.doc);
        
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
        if (field.type === 'hex') {
            if (field.size === undefined) {
                throw new Error(`Field "${displayName}": hex type requires size`);
            }
            const size = resolveExpr(context, field.size);
            const value = Array.from(new Uint8Array(context.buffer, startOffset, size))
                .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                .join('');
            if (shouldConsume) {
                context.offset += size;
            }
            
            const data = new Uint8Array(context.buffer, startOffset, size);
            const interpretType = new HexEncoding();
            const range = new BinaryRange(data, displayName, interpretType, [], field.doc);
            return [range, value];
        }

        const encoding = field.encoding ?? context.defaultEncoding;

        if (field.type === 'strz') {
            const maxSize = field.size !== undefined ? resolveExpr(context, field.size) : undefined;
            const [value, bytesRead] = readStringZ(context.dataView, context.offset, maxSize, encoding);
            if (shouldConsume) {
                context.offset += bytesRead;
            }

            const data = new Uint8Array(context.buffer, startOffset, bytesRead);
            const interpretType = createStringInterpretType(encoding);
            const range = new BinaryRange(data, displayName, interpretType, [], field.doc);
            return [range, value];
        } else {
            // str
            if (field.size === undefined) {
                throw new Error(`Field "${displayName}": str type requires size`);
            }
            const size = resolveExpr(context, field.size);
            const value = readString(context.dataView, context.offset, size, encoding);
            if (shouldConsume) {
                context.offset += size;
            }

            const data = new Uint8Array(context.buffer, startOffset, size);
            const interpretType = createStringInterpretType(encoding);
            const range = new BinaryRange(data, displayName, interpretType, [], field.doc);
            return [range, value];
        }
    }

    if (isBytesField(field)) {
        const size = resolveExpr(context, field.size);
        const value = new Uint8Array(context.buffer, startOffset, size);
        if (shouldConsume) {
            context.offset += size;
        }

        const range = new BinaryRange(value, displayName, new HexEncoding(), [], field.doc);
        return [range, value];
    }

    // ユーザー定義型
    if (isUserDefinedType(typeName, context.schema)) {
        const userType = context.schema.types![typeName];
        return parseUserType(context, userType, displayName);
    }

    // 外部スキーマを試す
    const externalKsyText = loadKsy(typeName);
    if (externalKsyText) {
        try {
            const externalSchema = parseKsySchema(externalKsyText);
            
            // 外部スキーマのコンテキストを一時的に設定
            const originalEndian = context.defaultEndian;
            const originalSchema = context.schema;
            
            if (externalSchema.meta && externalSchema.meta.endian) {
                context.defaultEndian = externalSchema.meta.endian;
            }
            context.schema = externalSchema;
            
            // externalSchema は seq を持つため、KsyType と互換がある
            const result = parseUserType(context, externalSchema as unknown as KsyType, displayName);
            
            // コンテキストを元に戻す
            context.defaultEndian = originalEndian;
            context.schema = originalSchema;
            
            return result;
        } catch (e) {
            throw new Error(`Failed to parse external schema "${typeName}": ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    throw new Error(`Unknown type: ${typeName}`);
}

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
    const range = new BinaryRange(data, displayName, null, subRanges, userType.doc);
    
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
 * 条件式（if）を評価
 */
function evaluateCondition(context: ParseContext, expr: string): boolean {
    if (!expr) return true;

    // KSYの論理演算子をJSの演算子に変換
    let jsExpr = expr
        .replace(/\band\b/g, '&&')
        .replace(/\bor\b/g, '||');

    // `if` や `in` などの予約語、またはハイフンを含むフィールド名は
    // そのまま JavaScript の識別子にできないため、安全なエイリアスに置換する。
    const aliases = Object.entries(context.values).map(([key, _value], index) => {
        const safeBase = key.replace(/[^A-Za-z0-9_$]/g, '_') || `field_${index}`;
        return [key, `__field_${safeBase}_${index}`] as const;
    });

    const aliasMap = Object.fromEntries(aliases);
    const safeNames = Object.values(aliasMap);
    const safeValues = Object.values(context.values);

    for (const [key, alias] of aliases) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|[^A-Za-z0-9_$])(${escaped})(?=$|[^A-Za-z0-9_$])`, 'g');
        jsExpr = jsExpr.replace(pattern, (_match, prefix) => `${prefix}${alias}`);
    }

    try {
        const func = new Function(...safeNames, `return !!(${jsExpr});`);
        return func(...safeValues);
    } catch (e) {
        console.warn(`Failed to evaluate condition: ${expr} -> ${jsExpr}`, e);
        return false;
    }
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
