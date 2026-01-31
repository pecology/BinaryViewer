/**
 * KSYスキーマのlocalStorage管理
 */

const KSY_PREFIX = 'ksy:';

export interface SavedKsy {
    name: string;
    content: string;
}

/**
 * KSYスキーマを保存
 */
export function saveKsy(name: string, content: string): void {
    localStorage.setItem(KSY_PREFIX + name, content);
}

/**
 * KSYスキーマを読み込み
 */
export function loadKsy(name: string): string | null {
    return localStorage.getItem(KSY_PREFIX + name);
}

/**
 * KSYスキーマを削除
 */
export function deleteKsy(name: string): void {
    localStorage.removeItem(KSY_PREFIX + name);
}

/**
 * 保存済みのKSYスキーマ一覧を取得
 */
export function listKsyNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(KSY_PREFIX)) {
            names.push(key.substring(KSY_PREFIX.length));
        }
    }
    return names.sort();
}

/**
 * KSYスキーマが存在するか確認
 */
export function hasKsy(name: string): boolean {
    return localStorage.getItem(KSY_PREFIX + name) !== null;
}

/**
 * 全てのKSYスキーマをエクスポート
 */
export function exportAllKsy(): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(KSY_PREFIX)) {
            const name = key.substring(KSY_PREFIX.length);
            const content = localStorage.getItem(key);
            if (content) {
                result[name] = content;
            }
        }
    }
    return result;
}

/**
 * KSYスキーマをインポート
 * @param data インポートするデータ
 * @param overwrite 上書きするかどうか
 * @returns インポートされたスキーマ名の配列
 */
export function importKsy(data: Record<string, string>, overwrite: boolean = false): string[] {
    const imported: string[] = [];
    for (const [name, content] of Object.entries(data)) {
        if (typeof content === 'string') {
            if (overwrite || !hasKsy(name)) {
                saveKsy(name, content);
                imported.push(name);
            }
        }
    }
    return imported;
}
