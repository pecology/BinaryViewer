// 拡張子とパーサーのマッピングを管理
// localStorage key format: 'ext-parser:{extension}' -> parser value

const STORAGE_PREFIX = 'ext-parser:';

export type ParserType = 'zip' | 'text' | `ksy:${string}`;

/**
 * 拡張子とパーサーの紐づけを保存
 * @param extension 拡張子（例: '.png', '.zip'）
 * @param parser パーサー種別（例: 'zip', 'text', 'ksy:png'）
 */
export function saveExtensionMapping(extension: string, parser: ParserType): void {
  const normalizedExt = normalizeExtension(extension);
  if (!normalizedExt) return;
  localStorage.setItem(STORAGE_PREFIX + normalizedExt, parser);
}

/**
 * 拡張子に紐づくパーサーを取得
 * @param extension 拡張子（例: '.png', '.zip'）
 * @returns パーサー種別、または未設定の場合はnull
 */
export function getParserForExtension(extension: string): ParserType | null {
  const normalizedExt = normalizeExtension(extension);
  if (!normalizedExt) return null;
  const value = localStorage.getItem(STORAGE_PREFIX + normalizedExt);
  return value as ParserType | null;
}

/**
 * 拡張子の紐づけを削除
 * @param extension 拡張子
 */
export function removeExtensionMapping(extension: string): void {
  const normalizedExt = normalizeExtension(extension);
  if (!normalizedExt) return;
  localStorage.removeItem(STORAGE_PREFIX + normalizedExt);
}

/**
 * すべての拡張子マッピングを取得
 * @returns {extension: parser} のオブジェクト
 */
export function getAllExtensionMappings(): Record<string, ParserType> {
  const mappings: Record<string, ParserType> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      const ext = key.substring(STORAGE_PREFIX.length);
      const parser = localStorage.getItem(key) as ParserType;
      if (parser) {
        mappings[ext] = parser;
      }
    }
  }
  return mappings;
}

/**
 * ファイル名から拡張子を抽出
 * @param fileName ファイル名
 * @returns 拡張子（小文字、ドット付き）例: '.png'
 */
export function getExtensionFromFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return '';
  }
  return fileName.substring(lastDot).toLowerCase();
}

/**
 * 拡張子を正規化（小文字、ドット付き）
 */
function normalizeExtension(extension: string): string {
  let ext = extension.toLowerCase().trim();
  if (!ext) return '';
  if (!ext.startsWith('.')) {
    ext = '.' + ext;
  }
  return ext;
}
