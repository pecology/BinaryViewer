/**
 * 簡易YAMLパーサー
 * ksyファイルの解析に必要な最小限のYAML機能のみサポート
 * 
 * サポート:
 * - キー: 値
 * - ネストされたオブジェクト（インデント）
 * - 配列（- 記法）
 * - 文字列（クォートあり/なし）
 * - 数値
 * - 16進数（0x...）
 * - コメント（#）
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlObject;
export type YamlObject = { [key: string]: YamlValue };

interface ParsedLine {
    indent: number;
    content: string;
    lineNumber: number;
}

/**
 * YAMLテキストをパース
 */
export function parseYaml(text: string): YamlObject {
    const lines = text.split(/\r?\n/);
    const parsedLines: ParsedLine[] = [];

    // 有効な行を抽出（空行とコメントのみの行を除外）
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // コメント部分を除去
        const commentIndex = line.indexOf('#');
        const contentPart = commentIndex >= 0 ? line.substring(0, commentIndex) : line;
        
        // 空白のみの行はスキップ
        if (contentPart.trim() === '') {
            continue;
        }

        // インデント計算（スペースのみ対応）
        const indent = contentPart.match(/^( *)/)?.[1].length ?? 0;
        
        parsedLines.push({
            indent,
            content: contentPart.trimEnd(),
            lineNumber: i + 1,
        });
    }

    if (parsedLines.length === 0) {
        return {};
    }

    const context = { lines: parsedLines, index: 0 };
    return parseObject(context, 0);
}

interface ParseContext {
    lines: ParsedLine[];
    index: number;
}

/**
 * オブジェクトをパース
 */
function parseObject(context: ParseContext, minIndent: number): YamlObject {
    const result: YamlObject = {};
    
    while (context.index < context.lines.length) {
        const line = context.lines[context.index];
        
        // インデントが減ったら終了
        if (line.indent < minIndent) {
            break;
        }

        const content = line.content.trim();

        // 配列要素の場合はスキップ（親で処理）
        if (content.startsWith('- ')) {
            break;
        }

        // キー: 値 のパース
        const colonIndex = content.indexOf(':');
        if (colonIndex === -1) {
            throw new Error(`Invalid YAML at line ${line.lineNumber}: expected "key: value"`);
        }

        const key = content.substring(0, colonIndex).trim();
        const valueStr = content.substring(colonIndex + 1).trim();

        context.index++;

        if (valueStr === '') {
            // 値がない場合は、次の行を見てオブジェクトか配列か判断
            if (context.index < context.lines.length) {
                const nextLine = context.lines[context.index];
                if (nextLine.indent > line.indent) {
                    if (nextLine.content.trim().startsWith('-')) {
                        result[key] = parseArray(context, nextLine.indent);
                    } else {
                        result[key] = parseObject(context, nextLine.indent);
                    }
                } else {
                    result[key] = null;
                }
            } else {
                result[key] = null;
            }
        } else {
            result[key] = parseValue(valueStr);
        }
    }

    return result;
}

/**
 * 配列をパース
 */
function parseArray(context: ParseContext, minIndent: number): YamlValue[] {
    const result: YamlValue[] = [];

    while (context.index < context.lines.length) {
        const line = context.lines[context.index];

        // インデントが減ったら終了
        if (line.indent < minIndent) {
            break;
        }

        const content = line.content.trim();

        // 配列要素でない場合も終了
        if (!content.startsWith('-')) {
            break;
        }

        // "- " の後の内容を取得
        const itemContent = content.substring(1).trim();

        context.index++;

        if (itemContent === '') {
            // 次の行がネストされている場合
            if (context.index < context.lines.length) {
                const nextLine = context.lines[context.index];
                if (nextLine.indent > line.indent) {
                    if (nextLine.content.trim().startsWith('-')) {
                        result.push(parseArray(context, nextLine.indent));
                    } else {
                        result.push(parseObject(context, nextLine.indent));
                    }
                } else {
                    result.push(null);
                }
            } else {
                result.push(null);
            }
        } else if (itemContent.includes(':')) {
            // インラインオブジェクト開始 "- key: value"
            const obj: YamlObject = {};
            const colonIndex = itemContent.indexOf(':');
            const key = itemContent.substring(0, colonIndex).trim();
            const valueStr = itemContent.substring(colonIndex + 1).trim();

            if (valueStr === '') {
                // 値がない場合、次の行を見る
                if (context.index < context.lines.length) {
                    const nextLine = context.lines[context.index];
                    if (nextLine.indent > line.indent) {
                        if (nextLine.content.trim().startsWith('-')) {
                            obj[key] = parseArray(context, nextLine.indent);
                        } else {
                            obj[key] = parseObject(context, nextLine.indent);
                        }
                    } else {
                        obj[key] = null;
                    }
                } else {
                    obj[key] = null;
                }
            } else {
                obj[key] = parseValue(valueStr);
            }

            // 同じ配列要素内の追加キーを読む
            while (context.index < context.lines.length) {
                const nextLine = context.lines[context.index];
                // 同じ配列要素のプロパティは、"- " の後の位置と同じインデント
                // 実際には - の次の文字位置（line.indent + 2）
                if (nextLine.indent <= line.indent) {
                    break;
                }
                if (nextLine.content.trim().startsWith('-')) {
                    break;
                }

                const nextContent = nextLine.content.trim();
                const nextColonIndex = nextContent.indexOf(':');
                if (nextColonIndex === -1) {
                    break;
                }

                const nextKey = nextContent.substring(0, nextColonIndex).trim();
                const nextValueStr = nextContent.substring(nextColonIndex + 1).trim();

                context.index++;

                if (nextValueStr === '') {
                    if (context.index < context.lines.length) {
                        const followingLine = context.lines[context.index];
                        if (followingLine.indent > nextLine.indent) {
                            if (followingLine.content.trim().startsWith('-')) {
                                obj[nextKey] = parseArray(context, followingLine.indent);
                            } else {
                                obj[nextKey] = parseObject(context, followingLine.indent);
                            }
                        } else {
                            obj[nextKey] = null;
                        }
                    } else {
                        obj[nextKey] = null;
                    }
                } else {
                    obj[nextKey] = parseValue(nextValueStr);
                }
            }

            result.push(obj);
        } else {
            result.push(parseValue(itemContent));
        }
    }

    return result;
}

/**
 * 単一値をパース
 */
function parseValue(str: string): YamlValue {
    // 空文字
    if (str === '') {
        return null;
    }

    // null
    if (str === 'null' || str === '~') {
        return null;
    }

    // boolean
    if (str === 'true') {
        return true;
    }
    if (str === 'false') {
        return false;
    }

    // 16進数
    if (str.match(/^0x[0-9a-fA-F]+$/)) {
        return parseInt(str, 16);
    }

    // 数値（整数・小数）
    if (str.match(/^-?\d+(\.\d+)?$/)) {
        return parseFloat(str);
    }

    // クォートされた文字列
    if ((str.startsWith('"') && str.endsWith('"')) ||
        (str.startsWith("'") && str.endsWith("'"))) {
        return str.slice(1, -1);
    }

    // インライン配列 [a, b, c]
    if (str.startsWith('[') && str.endsWith(']')) {
        const inner = str.slice(1, -1).trim();
        if (inner === '') {
            return [];
        }
        return inner.split(',').map(item => parseValue(item.trim()));
    }

    // それ以外は文字列
    return str;
}
