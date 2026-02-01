/**
 * KSYスキーマのlocalStorage管理
 */

const KSY_PREFIX = 'ksy:';

/** 保存結果 */
export interface SaveResult {
    success: boolean;
    error?: string;
}

export interface SavedKsy {
    name: string;
    content: string;
}

/**
 * KSYスキーマを保存
 * @returns 保存結果（成功/失敗とエラーメッセージ）
 */
export function saveKsy(name: string, content: string): SaveResult {
    try {
        localStorage.setItem(KSY_PREFIX + name, content);
        return { success: true };
    } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            return { 
                success: false, 
                error: 'localStorageの容量が上限に達しました。不要なスキーマを削除してください。' 
            };
        }
        return { 
            success: false, 
            error: `保存に失敗しました: ${e instanceof Error ? e.message : String(e)}` 
        };
    }
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
 * @returns インポート結果（成功したスキーマ名の配列とエラー情報）
 */
export function importKsy(data: Record<string, string>, overwrite: boolean = false): { imported: string[], errors: string[] } {
    const imported: string[] = [];
    const errors: string[] = [];
    for (const [name, content] of Object.entries(data)) {
        if (typeof content === 'string') {
            if (overwrite || !hasKsy(name)) {
                const result = saveKsy(name, content);
                if (result.success) {
                    imported.push(name);
                } else {
                    errors.push(`${name}: ${result.error}`);
                }
            }
        }
    }
    return { imported, errors };
}
