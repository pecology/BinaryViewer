/**
 * パーサー定義のCSV表現
 *
 * 列: scope,id,type,size,repeat,if,consume,encoding,contents,doc
 *  - scope が空      : ルート seq のフィールド行
 *  - scope が型名    : types.<型名>.seq のフィールド行
 *  - scope = @meta   : メタ情報（id=キー, type=値。file-extension は ; 区切り）
 *  - scope = @doc    : スキーマ全体の doc（doc 列に値）
 *  - scope = @typedoc: 型の doc（id=型名, doc 列に値）
 *  - repeat 列は repeat-expr の値（repeat: expr を暗黙とする）
 *  - contents 列は ; 区切りの数値（0x 形式可）
 */
import { parseYaml } from './YamlParser';
import type { YamlObject, YamlValue } from './YamlParser';

export const CSV_COLUMNS = ['scope', 'id', 'type', 'size', 'repeat', 'if', 'consume', 'encoding', 'contents', 'doc'] as const;
type Column = typeof CSV_COLUMNS[number];

const SCOPE_META = '@meta';
const SCOPE_DOC = '@doc';
const SCOPE_TYPEDOC = '@typedoc';

export function isCsvSchemaText(text: string): boolean {
    return /^\uFEFF?\s*scope\s*,/i.test(text);
}

/** RFC4180 準拠の簡易CSVパーサー（引用符内の改行・カンマ・"" に対応） */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

    for (; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(cell);
            cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell);
            cell = '';
            rows.push(row);
            row = [];
        } else {
            cell += ch;
        }
    }
    if (inQuotes) {
        throw new Error('CSV: 引用符が閉じられていません');
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows.filter(r => r.some(c => c.trim() !== ''));
}

function escapeCsvCell(value: string): string {
    return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

function toScalar(cell: string): string | number {
    const s = cell.trim();
    if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return s;
}

/** CSVテキストを、YAML/JSONをパースした場合と同じ構造に変換 */
export function csvToSchemaObject(text: string): YamlObject {
    const rows = parseCsv(text);
    if (rows.length === 0) {
        throw new Error('CSV is empty');
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    const idx = {} as Record<Column, number>;
    for (const col of CSV_COLUMNS) {
        idx[col] = header.indexOf(col);
    }
    if (idx.scope < 0 || idx.id < 0 || idx.type < 0) {
        throw new Error('CSV header must contain scope, id, type columns');
    }
    const get = (row: string[], col: Column): string => (idx[col] >= 0 ? row[idx[col]] ?? '' : '');

    const meta: YamlObject = {};
    const root: YamlObject = { meta };
    const seq: YamlValue[] = [];
    const types: Record<string, YamlObject> = {};
    root['seq'] = seq;

    const ensureType = (name: string): YamlObject => {
        if (!types[name]) types[name] = { seq: [] };
        return types[name];
    };

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const scope = get(row, 'scope').trim();

        if (scope === SCOPE_META) {
            const key = get(row, 'id').trim();
            const value = get(row, 'type').trim();
            if (!key) continue;
            if (key === 'file-extension') {
                const exts = value.split(';').map(s => s.trim()).filter(Boolean);
                meta[key] = exts.length === 1 ? exts[0] : exts;
            } else {
                meta[key] = value;
            }
            continue;
        }
        if (scope === SCOPE_DOC) {
            root['doc'] = get(row, 'doc');
            continue;
        }
        if (scope === SCOPE_TYPEDOC) {
            ensureType(get(row, 'id').trim())['doc'] = get(row, 'doc');
            continue;
        }

        const field: YamlObject = { id: get(row, 'id').trim(), type: get(row, 'type').trim() };
        const size = get(row, 'size').trim();
        if (size) field['size'] = toScalar(size);
        const repeat = get(row, 'repeat').trim();
        if (repeat) {
            field['repeat'] = 'expr';
            field['repeat-expr'] = toScalar(repeat);
        }
        const ifExpr = get(row, 'if');
        if (ifExpr.trim()) field['if'] = ifExpr;
        const consume = get(row, 'consume').trim().toLowerCase();
        if (consume === 'true' || consume === 'false') field['consume'] = consume === 'true';
        const encoding = get(row, 'encoding').trim();
        if (encoding) field['encoding'] = encoding;
        const contents = get(row, 'contents').trim();
        if (contents) {
            field['contents'] = contents.split(';').map(s => {
                const v = toScalar(s);
                if (typeof v !== 'number') throw new Error(`CSV: contents must be numbers (row ${r + 1}: "${s}")`);
                return v;
            });
        }
        const doc = get(row, 'doc');
        if (doc.trim()) field['doc'] = doc;

        const target = scope === '' ? seq : (ensureType(scope)['seq'] as YamlValue[]);
        target.push(field);
    }

    if (Object.keys(types).length > 0) {
        root['types'] = types;
    }
    return root;
}

function scalarToCell(v: YamlValue | undefined): string {
    if (v === undefined || v === null) return '';
    return String(v);
}

/** YAML/JSON をパースしたオブジェクトをCSVテキストに変換 */
export function schemaObjectToCsv(obj: YamlObject): string {
    const lines: string[] = [CSV_COLUMNS.join(',')];
    const emit = (cells: Partial<Record<Column, string>>) => {
        lines.push(CSV_COLUMNS.map(c => escapeCsvCell(cells[c] ?? '')).join(','));
    };

    const meta = (obj['meta'] ?? {}) as YamlObject;
    for (const [key, value] of Object.entries(meta)) {
        const text = Array.isArray(value) ? value.map(scalarToCell).join(';') : scalarToCell(value);
        emit({ scope: SCOPE_META, id: key, type: text });
    }
    if (typeof obj['doc'] === 'string') {
        emit({ scope: SCOPE_DOC, doc: obj['doc'] });
    }

    const emitFields = (scope: string, seq: YamlValue) => {
        if (!Array.isArray(seq)) return;
        for (const item of seq) {
            const f = item as YamlObject;
            const contents = f['contents'];
            emit({
                scope,
                id: scalarToCell(f['id']),
                type: scalarToCell(f['type']),
                size: scalarToCell(f['size']),
                repeat: scalarToCell(f['repeat-expr']),
                if: scalarToCell(f['if']),
                consume: scalarToCell(f['consume']),
                encoding: scalarToCell(f['encoding']),
                contents: Array.isArray(contents)
                    ? contents.map(v => (typeof v === 'number' ? `0x${v.toString(16).toUpperCase().padStart(2, '0')}` : scalarToCell(v))).join(';')
                    : '',
                doc: scalarToCell(f['doc']),
            });
        }
    };

    emitFields('', obj['seq']);

    const types = obj['types'];
    if (types && typeof types === 'object') {
        for (const [name, def] of Object.entries(types as YamlObject)) {
            const typeDef = def as YamlObject;
            if (typeof typeDef['doc'] === 'string') {
                emit({ scope: SCOPE_TYPEDOC, id: name, doc: typeDef['doc'] });
            }
            emitFields(name, typeDef['seq']);
        }
    }

    return lines.join('\n') + '\n';
}

function yamlScalar(value: string | number | boolean): string {
    if (typeof value !== 'string') return String(value);
    const needsQuote =
        value === '' ||
        /^(true|false|null|~)$/.test(value) ||
        /^(0x[0-9a-fA-F]+|-?\d+(\.\d+)?)$/.test(value) ||
        /^[\s\-?:,[\]{}&*!|>'"%@`]/.test(value) ||
        /\s$/.test(value) ||
        value.includes(': ');
    if (!needsQuote) return value;
    return value.includes('"') ? `'${value}'` : `"${value}"`;
}

function yamlEntry(key: string, value: YamlValue, prefix: string, bodyIndent = prefix): string[] {
    if (typeof value === 'string' && value.includes('\n')) {
        return [`${prefix}${key}: |`, ...value.replace(/\n+$/, '').split('\n').map(l => `${bodyIndent}  ${l}`)];
    }
    if (Array.isArray(value)) {
        return [`${prefix}${key}: [${value.map(v => yamlScalar(v as string | number | boolean)).join(', ')}]`];
    }
    return [`${prefix}${key}: ${yamlScalar(value as string | number | boolean)}`];
}

function yamlFieldList(seq: YamlValue[], indent: string): string[] {
    const out: string[] = [];
    for (const item of seq) {
        const f = item as YamlObject;
        let first = true;
        for (const [key, value] of Object.entries(f)) {
            out.push(...(first
                ? yamlEntry(key, value, `${indent}- `, `${indent}  `)
                : yamlEntry(key, value, `${indent}  `)));
            first = false;
        }
    }
    return out;
}
/** パース済みオブジェクトをYAMLテキストに変換 */
export function schemaObjectToYaml(obj: YamlObject): string {
    const out: string[] = ['meta:'];
    for (const [key, value] of Object.entries((obj['meta'] ?? {}) as YamlObject)) {
        out.push(...yamlEntry(key, value, '  '));
    }
    if (typeof obj['doc'] === 'string') {
        out.push(...yamlEntry('doc', obj['doc'], ''));
    }
    out.push('seq:', ...yamlFieldList((obj['seq'] ?? []) as YamlValue[], '  '));

    const types = obj['types'];
    if (types && typeof types === 'object' && Object.keys(types).length > 0) {
        out.push('types:');
        for (const [name, def] of Object.entries(types as YamlObject)) {
            const typeDef = def as YamlObject;
            out.push(`  ${name}:`);
            if (typeof typeDef['doc'] === 'string') {
                out.push(...yamlEntry('doc', typeDef['doc'], '    '));
            }
            out.push('    seq:', ...yamlFieldList((typeDef['seq'] ?? []) as YamlValue[], '      '));
        }
    }
    return out.join('\n') + '\n';
}

/** 入力テキスト（YAML/JSON/CSV）をオブジェクトに */
function textToObject(text: string): YamlObject {
    if (isCsvSchemaText(text)) return csvToSchemaObject(text);
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed) as YamlObject;
        } catch {
            // YAMLとして試行
        }
    }
    return parseYaml(text);
}

export function convertSchemaTextToCsv(text: string): string {
    return schemaObjectToCsv(textToObject(text));
}

export function convertSchemaTextToYaml(text: string): string {
    return schemaObjectToYaml(textToObject(text));
}
