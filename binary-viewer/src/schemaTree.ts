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
