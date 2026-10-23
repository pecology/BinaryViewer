/**
 * スキーマ名の階層化
 *
 * スキーマ名を「-」で区切り、パーサー選択やスキーマ一覧で階層表示するためのツリーを作る。
 * 例: "通信-機器A-コマンド" → 通信 > 機器A > コマンド
 */

export const SCHEMA_NAME_SEPARATOR = '-';

export interface SchemaTreeNode {
    /** この階層の表示名（区切った末尾の部分） */
    label: string;
    /** スキーマとして存在する場合のフルネーム（途中の階層だけのノードは undefined） */
    name?: string;
    children: SchemaTreeNode[];
}

/** スキーマ名を階層に区切る（空の部分は無視し、何も残らなければ名前全体を1階層とする） */
export function splitSchemaName(name: string): string[] {
    const segments = name.split(SCHEMA_NAME_SEPARATOR).filter(segment => segment !== '');
    return segments.length > 0 ? segments : [name];
}

/** スキーマ名のグループ部分（最後の区切りより前）。グループに属さない名前は null */
export function getSchemaGroup(name: string): string | null {
    const segments = splitSchemaName(name);
    return segments.length > 1 ? segments.slice(0, -1).join(SCHEMA_NAME_SEPARATOR) : null;
}

/**
 * KSY の type に書かれたスキーマ名を、保存済みスキーマのフルネームに解決する
 * 自分のグループからの相対名（グループ名を省略した書き方）を優先し、なければフルネームとして扱う
 * 例: "通信-機器A-コマンド" の中の "ヘッダ" → "通信-機器A-ヘッダ"（あれば）→ "ヘッダ"
 * @param currentSchemaName 参照元のスキーマ名（不明なら相対名は使わない）
 * @param exists その名前のスキーマが保存されているか
 * @returns 解決したフルネーム。見つからなければ null
 */
export function resolveSchemaReference(currentSchemaName: string | undefined, typeName: string, exists: (name: string) => boolean): string | null {
    const group = currentSchemaName ? getSchemaGroup(currentSchemaName) : null;
    if (group) {
        const relativeName = `${group}${SCHEMA_NAME_SEPARATOR}${typeName}`;
        if (exists(relativeName)) return relativeName;
    }
    return exists(typeName) ? typeName : null;
}

/** 参照元と同じグループのスキーマなら、グループ名を省略した名前を返す（それ以外はフルネームのまま） */
export function getRelativeSchemaName(currentSchemaName: string, targetName: string): string {
    const group = getSchemaGroup(currentSchemaName);
    const prefix = group ? `${group}${SCHEMA_NAME_SEPARATOR}` : null;
    return prefix && targetName.startsWith(prefix) && targetName.length > prefix.length
        ? targetName.slice(prefix.length)
        : targetName;
}

/** スキーマ名の一覧から階層ツリーを作る（各階層は表示名順） */
export function buildSchemaTree(names: string[]): SchemaTreeNode[] {
    const root: SchemaTreeNode[] = [];
    for (const name of names) {
        let siblings = root;
        let node: SchemaTreeNode | undefined;
        for (const segment of splitSchemaName(name)) {
            node = siblings.find(child => child.label === segment);
            if (!node) {
                node = { label: segment, children: [] };
                siblings.push(node);
            }
            siblings = node.children;
        }
        node!.name = name;
    }
    sortTree(root);
    return root;
}

function sortTree(nodes: SchemaTreeNode[]): void {
    nodes.sort((a, b) => a.label.localeCompare(b.label, 'ja', { numeric: true }));
    nodes.forEach(node => sortTree(node.children));
}

/**
 * ツリーを表示順（深さ優先）にたどる
 * @param visit ノードとその深さ（最上位は0）を受け取る
 */
export function walkSchemaTree(nodes: SchemaTreeNode[], visit: (node: SchemaTreeNode, depth: number) => void, depth = 0): void {
    for (const node of nodes) {
        visit(node, depth);
        walkSchemaTree(node.children, visit, depth + 1);
    }
}
