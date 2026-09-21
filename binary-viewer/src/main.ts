import './style.css'
import { parseKsySchema, parseBinary } from './ksy/DynamicParser.ts'
import { saveKsy, loadKsy, deleteKsy, listKsyNames, hasKsy, exportAllKsy, importKsy } from './ksyStorage.ts'
import { saveExtensionMapping, getParserForExtension, getExtensionFromFileName, getAllExtensionMappings, removeExtensionMapping, type ParserType } from './extensionMapping.ts'
import { getBuiltinParsers, getBuiltinParser } from './parserRegistry.ts'
import type { BinaryRange } from './BinaryRange.ts'

// 現在読み込んでいるバイナリデータ（編集可能）
// パース時は editableData.buffer でArrayBufferとして渡す
let editableData: Uint8Array | null = null;
let currentFileName: string = '';
// 現在のパース結果（イベントリスナーから参照）
let currentParseResult: BinaryRange | null = null;
// 1ページ当たりの表示バイト数（16の倍数推奨）
let bytesPerPage = 1024;

function chunk<T>(source: Iterable<T>, chunkSize: number): T[][] {
    const result: T[][] = [];
    let temp: T[] = [];
    for (const item of source) {
        temp.push(item);
        if (temp.length === chunkSize) {
            result.push(temp);
            temp = [];
        }
    }
    if (temp.length > 0) {
        result.push(temp);
    }
    return result;
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="three-column-layout">
    <div class="panel input-panel">
      <h3>入力</h3>
      <div id="drop-zone" class="drop-zone" tabindex="0">
          <span class="drop-zone-text">ファイルをドラッグ＆ドロップ<br/>またはクリックで選択<br/>または Ctrl+V</span>
          <input type="file" id="fileInput" />
      </div>
      <div class="text-input-section" style="margin: 0 10px 10px; padding: 10px; background: #fff; border: 1px solid #ddd; border-radius: 4px;">
          <textarea id="hex-text-input" placeholder="Hexテキスト入力 (例: 01 02 0A... 入力すると自動パースされます)" style="width: 100%; height: 60px; resize: vertical; margin-bottom: 0px; box-sizing: border-box; font-family: monospace;"></textarea>
      </div>
      <div id="current-file-name" class="current-file-name"></div>
      <div class="parser-section">
          <label>パーサー:</label>
          <select id="parser-select">
              <!-- 動的に生成 -->
          </select>
          <button id="ksy-manage-btn" title="KSYスキーマ管理">📝 KSY管理</button>
          <button id="link-ext-btn" title="この拡張子に紐づける">🔗 拡張子に紐づけ</button>
          <div id="ext-mapping-info" class="ext-mapping-info"></div>
          <details class="ext-mapping-list">
              <summary>拡張子マッピング一覧</summary>
              <div id="ext-mapping-list-content"></div>
          </details>
      </div>
      <div id="error-message" class="error-message"></div>
    </div>
    <div class="panel hex-panel">
      <h3>Hex <span id="edit-hint" class="edit-hint">(ダブルクリックで編集)</span></h3>
      <div id="hex-table-control"></div>
      <div id="hex-table"></div>
      <div class="download-section">
          <button id="download-btn" disabled>💾 編集したデータをダウンロード</button>
      </div>
    </div>
    <div class="panel structure-panel">
      <h3>構造 <span class="structure-controls"><button id="expand-all-btn" title="全て開く">▼ 全開</button><button id="collapse-all-btn" title="全て閉じる">▶ 全閉</button></span></h3>
      <div class="details-wrapper"></div>
    </div>
  </div>
  
  <!-- KSYスキーマ管理モーダル -->
  <div id="ksy-modal" class="modal-overlay" style="display: none;">
    <div class="modal-content">
      <div class="modal-header">
        <h3>📝 KSYスキーマ管理</h3>
        <button id="ksy-modal-close" class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="ksy-modal-layout">
          <div class="ksy-list-panel">
            <h4>保存済みスキーマ</h4>
            <ul id="ksy-schema-list" class="ksy-schema-list"></ul>
            <button id="ksy-new-btn" class="ksy-new-btn">+ 新規作成</button>
          </div>
          <div class="ksy-edit-panel">
            <div class="ksy-edit-header">
              <input type="text" id="ksy-save-name" placeholder="スキーマ名" />
              <div class="ksy-edit-buttons">
                <button id="ksy-save-btn" title="保存">💾 保存</button>
                <button id="ksy-delete-btn" title="削除">🗑️ 削除</button>
              </div>
            </div>
            
            <div class="ksy-editor-tabs" style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button id="ksy-tab-raw" class="active" style="flex: 1; padding: 4px; border: 1px solid #1a73e8; background: #1a73e8; color: white; cursor: pointer; border-radius: 4px;">YAMLエディタ</button>
                <button id="ksy-tab-gui" style="flex: 1; padding: 4px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; border-radius: 4px;">GUIビルダー</button>
            </div>
            
            <div id="ksy-raw-editor" style="display: flex; flex-direction: column; flex: 1;">
              <div class="ksy-file-row">
                <label>ファイルから読み込み:</label>
                <input type="file" id="ksyFileInput" accept=".ksy,.yaml,.yml" />
              </div>
              <textarea id="ksyText" placeholder="meta:\n  id: my_format\n  endian: le\nseq:\n  - id: magic\n    type: u4"></textarea>
            </div>
            
            <div id="ksy-gui-editor" style="display: none; flex-direction: column; flex: 1; overflow-y: auto; padding: 10px; border: 1px solid #ccc; border-radius: 4px; background: #fafafa;">
                <div style="display: flex; gap: 8px; margin-bottom: 10px; align-items: center;">
                    <label style="font-weight: bold; font-size: 13px;">Endian:</label>
                    <select id="ksy-gui-endian" style="padding: 4px;">
                        <option value="le">Little Endian (le)</option>
                        <option value="be">Big Endian (be)</option>
                    </select>
                </div>
                <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #333;">Fields (seq)</h4>
                <div id="ksy-gui-fields" style="display: flex; flex-direction: column; gap: 8px;"></div>
                <button id="ksy-gui-add-field-btn" style="margin-top: 10px; padding: 6px; border: 1px dashed #999; background: #fff; cursor: pointer; border-radius: 4px;">+ フィールド追加</button>
            </div>

            <button id="ksy-apply-btn" class="ksy-apply-btn" style="display: none;">▶ 適用（保存せずにパース）</button>
          </div>
        </div>
        <div class="ksy-export-import-row">
          <button id="ksy-export-all-btn">📤 全てエクスポート</button>
          <button id="ksy-import-btn">📥 インポート</button>
          <input type="file" id="ksy-import-file" accept=".json" style="display: none;" />
        </div>
      </div>
    </div>
  </div>
`;

/**
 * パーサー選択ドロップダウンの内容を再構築する関数
 * 
 * 組み込みパーサーとlocalStorageに保存されたKSYスキーマを
 * optgroup付きで一覧表示する。
 * 
 * @param selectedValue - 選択状態にしたいパーサーの値（例: "zip", "ksy:myschema"）
 *                        指定した場合: そのパーサーを選択状態にする
 *                        省略した場合: 現在選択中のパーサーを維持する
 *                        （ただし、該当するoptionが存在しない場合は先頭が選択される）
 * 
 * @example
 * // KSYスキーマを保存した後に呼び出し（新しいスキーマを選択状態に）
 * updateParserSelect('ksy:newSchema');
 * 
 * @example
 * // KSYスキーマを削除した後に呼び出し（現在の選択を維持、なければ先頭）
 * updateParserSelect();
 */
function updateParserSelect(selectedValue?: string): void {
    const select = document.querySelector<HTMLSelectElement>('#parser-select')!;
    const currentValue = selectedValue ?? select.value;
    
    // 組み込みパーサー（レジストリから動的に生成）
    const builtinParsers = getBuiltinParsers();
    let html = `
        <optgroup label="組み込みパーサー">
            ${builtinParsers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </optgroup>
    `;
    
    // 保存済みKSYスキーマ
    const ksyNames = listKsyNames();
    if (ksyNames.length > 0) {
        html += `<optgroup label="KSYスキーマ">`;
        ksyNames.forEach(name => {
            html += `<option value="ksy:${name}">📄 ${name}</option>`;
        });
        html += `</optgroup>`;
    }
    
    select.innerHTML = html;
    
    // 値を復元（存在する場合）
    if (currentValue) {
        const option = select.querySelector<HTMLOptionElement>(`option[value="${currentValue}"]`);
        if (option) {
            select.value = currentValue;
        }
    }
}

// 初期化時にパーサーセレクトを更新
updateParserSelect();

// KSYモーダル関連
const ksyModal = document.querySelector<HTMLDivElement>('#ksy-modal')!;

/** KSYスキーマ一覧を更新 */
function updateKsySchemaList(): void {
    const list = document.querySelector<HTMLUListElement>('#ksy-schema-list')!;
    const names = listKsyNames();
    
    if (names.length === 0) {
        list.innerHTML = '<li class="ksy-list-empty">保存済みスキーマはありません</li>';
        return;
    }
    
    list.innerHTML = names.map(name => 
        `<li class="ksy-list-item" data-name="${name}">${name}</li>`
    ).join('');
    
    // クリックでスキーマをロード
    list.querySelectorAll<HTMLLIElement>('.ksy-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const name = item.dataset.name!;
            const content = loadKsy(name);
            if (content) {
                document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = content;
                document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = name;
                // 選択状態を表示
                list.querySelectorAll('.ksy-list-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            }
        });
    });
}

/** モーダルを開く */
function openKsyModal(): void {
    updateKsySchemaList();
    ksyModal.style.display = 'flex';
}

/** モーダルを閉じる */
function closeKsyModal(): void {
    ksyModal.style.display = 'none';
}

// モーダル開くボタン
document.querySelector<HTMLButtonElement>('#ksy-manage-btn')!.addEventListener('click', openKsyModal);

// モーダル閉じるボタン
document.querySelector<HTMLButtonElement>('#ksy-modal-close')!.addEventListener('click', closeKsyModal);

// モーダル背景クリックで閉じる
ksyModal.addEventListener('click', (e) => {
    if (e.target === ksyModal) {
        closeKsyModal();
    }
});

// Escキーでモーダルを閉じる
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ksyModal.style.display === 'flex') {
        closeKsyModal();
    }
});

// 新規作成ボタン
document.querySelector<HTMLButtonElement>('#ksy-new-btn')!.addEventListener('click', () => {
    document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = '';
    document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = `meta:
  id: my_format
  endian: le
seq:
  - id: magic
    type: u4`;
    // 選択状態をクリア
    document.querySelectorAll('.ksy-list-item').forEach(i => i.classList.remove('selected'));
});

// パーサー選択時に再パース
document.querySelector<HTMLSelectElement>('#parser-select')!.addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    const value = select.value;
    
    // KSYスキーマが選択された場合、エディタにロード
    if (value.startsWith('ksy:')) {
        const ksyName = value.substring(4);
        const content = loadKsy(ksyName);
        if (content) {
            document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = content;
            document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = ksyName;
        }
    }
    
    // データがあれば再パース
    if (editableData) {
        parseAndDisplay();
    }
});

// アコーディオン全開ボタン
document.querySelector<HTMLButtonElement>('#expand-all-btn')!.addEventListener('click', () => {
    document.querySelectorAll<HTMLDetailsElement>('.details-wrapper details').forEach(details => {
        details.open = true;
    });
});

// アコーディオン全閉ボタン
document.querySelector<HTMLButtonElement>('#collapse-all-btn')!.addEventListener('click', () => {
    document.querySelectorAll<HTMLDetailsElement>('.details-wrapper details').forEach(details => {
        details.open = false;
    });
});

// ファイル選択時に自動パース
document.querySelector<HTMLInputElement>('#fileInput')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
        await loadFile(input.files[0]);
    }
});

// ドロップゾーンのクリックでファイル選択
document.querySelector<HTMLDivElement>('#drop-zone')!.addEventListener('click', () => {
    document.querySelector<HTMLInputElement>('#fileInput')!.click();
});

// ドラッグ＆ドロップ対応
const dropZone = document.querySelector<HTMLDivElement>('#drop-zone')!;

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        await loadFile(e.dataTransfer.files[0]);
    }
});

// クリップボードからのペースト対応
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                await loadFile(file);
                return;
            }
        }
    }
});

// 現在のパーサー設定値を取得
function getCurrentParserValue(): ParserType {
    const parserSelect = document.querySelector<HTMLSelectElement>('#parser-select')!;
    return parserSelect.value as ParserType;
}

// パーサーを設定する（拡張子マッピングからの自動選択時に使用）
function setParser(parser: ParserType): void {
    const parserSelect = document.querySelector<HTMLSelectElement>('#parser-select')!;
    
    // まずセレクトを更新（KSYスキーマが追加されている可能性があるため）
    updateParserSelect(parser);
    
    // 値が存在する場合は設定
    const option = parserSelect.querySelector<HTMLOptionElement>(`option[value="${parser}"]`);
    if (option) {
        parserSelect.value = parser;
        
        // KSYスキーマの場合はエディタにロード
        if (parser.startsWith('ksy:')) {
            const ksyName = parser.substring(4);
            const content = loadKsy(ksyName);
            if (content) {
                document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = content;
                document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = ksyName;
            }
        }
    }
}

// 拡張子マッピング情報を更新
function updateExtMappingInfo(): void {
    const infoDiv = document.querySelector<HTMLDivElement>('#ext-mapping-info')!;
    if (!currentFileName) {
        infoDiv.textContent = '';
        return;
    }
    const ext = getExtensionFromFileName(currentFileName);
    if (!ext) {
        infoDiv.textContent = '';
        return;
    }
    const mapped = getParserForExtension(ext);
    if (mapped) {
        infoDiv.textContent = `${ext} → ${mapped}`;
    } else {
        infoDiv.textContent = `${ext}: 未設定`;
    }
}

// ファイルを読み込む共通関数
async function loadFile(file: File): Promise<void> {
    clearError();
    try {
        const arrayBuffer = await file.arrayBuffer();
        currentFileName = file.name;
        // 編集可能なUint8Arrayを作成
        editableData = new Uint8Array(arrayBuffer);
        
        document.querySelector<HTMLSpanElement>('#current-file-name')!.textContent = `📄 ${file.name}`;
        document.querySelector<HTMLButtonElement>('#download-btn')!.disabled = false;
        
        // 拡張子に基づいてパーサーを自動選択
        const ext = getExtensionFromFileName(file.name);
        const mappedParser = getParserForExtension(ext);
        if (mappedParser) {
            setParser(mappedParser);
        }
        updateExtMappingInfo();
        
        await parseAndDisplay();
    } catch (e) {
        showError(`ファイル読み込みエラー: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// 拡張子に紐づけボタン
document.querySelector<HTMLButtonElement>('#link-ext-btn')!.addEventListener('click', () => {
    if (!currentFileName) {
        alert('ファイルを選択してください');
        return;
    }
    const ext = getExtensionFromFileName(currentFileName);
    if (!ext) {
        alert('ファイルに拡張子がありません');
        return;
    }
    const parserValue = getCurrentParserValue();
    saveExtensionMapping(ext, parserValue);
    updateExtMappingInfo();
    updateExtMappingList();
    alert(`拡張子 "${ext}" を "${parserValue}" に紐づけました`);
});

// 拡張子マッピング一覧を更新
function updateExtMappingList(): void {
    const container = document.querySelector<HTMLDivElement>('#ext-mapping-list-content')!;
    const mappings = getAllExtensionMappings();
    const entries = Object.entries(mappings);
    
    if (entries.length === 0) {
        container.innerHTML = '<div class="ext-mapping-empty">マッピングなし</div>';
        return;
    }
    
    container.innerHTML = entries.map(([ext, parser]) => `
        <div class="ext-mapping-item">
            <span class="ext-mapping-ext">${ext}</span>
            <span class="ext-mapping-arrow">→</span>
            <span class="ext-mapping-parser">${parser}</span>
            <button class="ext-mapping-delete" data-ext="${ext}" title="削除">✕</button>
        </div>
    `).join('');
    
    // 削除ボタンのイベントハンドラ
    container.querySelectorAll<HTMLButtonElement>('.ext-mapping-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const ext = btn.dataset.ext!;
            if (confirm(`"${ext}" のマッピングを削除しますか？`)) {
                removeExtensionMapping(ext);
                updateExtMappingList();
                updateExtMappingInfo();
            }
        });
    });
}

// 初期化時にマッピング一覧を更新
updateExtMappingList();

// ダウンロードボタン
document.querySelector<HTMLButtonElement>('#download-btn')!.addEventListener('click', () => {
    if (!editableData || !currentFileName) {
        alert('ファイルが読み込まれていません');
        return;
    }
    
    const blob = new Blob([new Uint8Array(editableData)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// KSYファイル読み込み時にテキストエリアに反映
document.querySelector<HTMLInputElement>('#ksyFileInput')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
        const text = await input.files[0].text();
        document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = text;
        // ファイル名からスキーマ名を設定
        const fileName = input.files[0].name.replace(/\.(ksy|yaml|yml)$/i, '');
        document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = fileName;
    }
});

// KSYを保存
document.querySelector<HTMLButtonElement>('#ksy-save-btn')!.addEventListener('click', () => {
    const nameInput = document.querySelector<HTMLInputElement>('#ksy-save-name')!;
    const textArea = document.querySelector<HTMLTextAreaElement>('#ksyText')!;
    const name = nameInput.value.trim();
    
    // もしGUIタブが開かれていたら、先にYAMLに変換する
    const tabGui = document.querySelector<HTMLButtonElement>('#ksy-tab-gui');
    if (tabGui && tabGui.classList.contains('active') && typeof (window as any).generateYamlFromGui === 'function') {
        const yaml = (window as any).generateYamlFromGui();
        if (yaml === null) return; // エラー時は中断
        textArea.value = yaml;
    }

    const content = textArea.value.trim();
    
    if (!name) {
        alert('スキーマ名を入力してください');
        return;
    }
    if (!content) {
        alert('スキーマ定義を入力してください');
        return;
    }
    
    if (hasKsy(name) && !confirm(`"${name}" は既に存在します。上書きしますか？`)) {
        return;
    }
    
    const result = saveKsy(name, content);
    if (result.success) {
        updateParserSelect(`ksy:${name}`);
        updateKsySchemaList();
        // 保存したスキーマを選択状態に
        document.querySelectorAll<HTMLLIElement>('.ksy-list-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.name === name);
        });
        
        // ファイルが読み込まれていれば自動でパースを実行
        if (editableData) {
            parseAndDisplay();
        }
        
        alert(`"${name}" を保存しました`);
    } else {
        alert(`保存エラー: ${result.error}`);
    }
});

// 保存済みKSYを削除
document.querySelector<HTMLButtonElement>('#ksy-delete-btn')!.addEventListener('click', () => {
    const nameInput = document.querySelector<HTMLInputElement>('#ksy-save-name')!;
    const name = nameInput.value.trim();
    if (!name) {
        alert('削除するスキーマ名を入力してください');
        return;
    }
    if (!hasKsy(name)) {
        alert(`"${name}" は保存されていません`);
        return;
    }
    if (confirm(`"${name}" を削除しますか？`)) {
        deleteKsy(name);
        updateParserSelect();
        updateKsySchemaList();
        nameInput.value = '';
        document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = '';
        alert(`"${name}" を削除しました`);
    }
});

// KSYを適用（保存せずにパース）
document.querySelector<HTMLButtonElement>('#ksy-apply-btn')!.addEventListener('click', () => {
    const textArea = document.querySelector<HTMLTextAreaElement>('#ksyText')!;
    const content = textArea.value.trim();
    
    if (!content) {
        alert('スキーマ定義を入力してください');
        return;
    }
    
    if (editableData) {
        // 一時的なパース用にパーサー選択を変更せずにパース
        clearError();
        try {
            const schema = parseKsySchema(content);
            const result = parseBinary(editableData.buffer as ArrayBuffer, schema);
            if (result.warnings.length > 0) {
                console.warn('Parse warnings:', result.warnings);
            }
            displayParseResult(result.root);
        } catch (e) {
            showError(`パースエラー: ${e instanceof Error ? e.message : String(e)}`);
        }
    } else {
        alert('ファイルを読み込んでください');
    }
});

// KSY全エクスポート
document.querySelector<HTMLButtonElement>('#ksy-export-all-btn')!.addEventListener('click', () => {
    const data = exportAllKsy();
    const names = Object.keys(data);
    
    if (names.length === 0) {
        alert('エクスポートするKSYスキーマがありません');
        return;
    }
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ksy-schemas.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert(`${names.length} 件のKSYスキーマをエクスポートしました`);
});

// KSYインポートボタン
document.querySelector<HTMLButtonElement>('#ksy-import-btn')!.addEventListener('click', () => {
    document.querySelector<HTMLInputElement>('#ksy-import-file')!.click();
});

// KSYインポートファイル選択
document.querySelector<HTMLInputElement>('#ksy-import-file')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    try {
        const text = await input.files[0].text();
        const data = JSON.parse(text);
        
        if (typeof data !== 'object' || data === null) {
            throw new Error('無効なJSONフォーマット');
        }
        
        const existingNames = listKsyNames();
        const newNames = Object.keys(data);
        const conflicts = newNames.filter(name => existingNames.includes(name));
        
        let overwrite = false;
        if (conflicts.length > 0) {
            overwrite = confirm(
                `以下のスキーマが既に存在します:\n${conflicts.join(', ')}\n\n上書きしますか？`
            );
        }
        
        const { imported, errors } = importKsy(data, overwrite);
        updateParserSelect();
        updateKsySchemaList();
        
        if (imported.length > 0) {
            let message = `${imported.length} 件のKSYスキーマをインポートしました:\n${imported.join(', ')}`;
            if (errors.length > 0) {
                message += `\n\nエラー:\n${errors.join('\n')}`;
            }
            alert(message);
        } else if (errors.length > 0) {
            alert(`インポートエラー:\n${errors.join('\n')}`);
        } else {
            alert('インポートされたスキーマはありません');
        }
    } catch (err) {
        alert(`インポートエラー: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // ファイル選択をリセット
    input.value = '';
});

// エラーメッセージを表示する関数
function showError(message: string): void {
    const errorDiv = document.querySelector<HTMLDivElement>('#error-message');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

// エラーメッセージをクリアする関数
function clearError(): void {
    const errorDiv = document.querySelector<HTMLDivElement>('#error-message');
    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
    }
}

// パースして表示する関数
async function parseAndDisplay(): Promise<void> {
    const parserSelect = document.querySelector<HTMLSelectElement>('#parser-select')!;
    clearError();
    
    if (!editableData) {
        return;
    }
    
    const parserType = parserSelect.value;
    
    let parseResult: BinaryRange;
    try {
        // 組み込みパーサーをチェック
        const builtinParser = getBuiltinParser(parserType);
        if (builtinParser) {
            parseResult = builtinParser.parse(editableData);
        } else if (parserType.startsWith('ksy:')) {
            // 保存済みKSYスキーマを使用
            const ksyName = parserType.substring(4);
            const ksyContent = loadKsy(ksyName);
            if (!ksyContent) {
                showError(`KSYスキーマ "${ksyName}" が見つかりません`);
                return;
            }
            const schema = parseKsySchema(ksyContent);
            const result = parseBinary(editableData.buffer as ArrayBuffer, schema);
            if (result.warnings.length > 0) {
                console.warn('Parse warnings:', result.warnings);
            }
            parseResult = result.root;
        } else {
            showError('不明なパーサータイプ');
            return;
        }
    } catch (e) {
        showError(`パースエラー: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    
    // グローバル変数を更新（イベントリスナーから参照）
    currentParseResult = parseResult;
    
    displayParseResult(parseResult);
}

// アコーディオン（details）の開閉状態を保存
function saveAccordionState(): Set<string> {
    const openOffsets = new Set<string>();
    document.querySelectorAll<HTMLDetailsElement>('.details-wrapper details[open]').forEach(details => {
        const offset = details.dataset.offset;
        const length = details.dataset.length;
        if (offset !== undefined && length !== undefined) {
            openOffsets.add(`${offset}-${length}`);
        }
    });
    return openOffsets;
}

// アコーディオン（details）の開閉状態を復元
function restoreAccordionState(openOffsets: Set<string>): void {
    document.querySelectorAll<HTMLDetailsElement>('.details-wrapper details').forEach(details => {
        const offset = details.dataset.offset;
        const length = details.dataset.length;
        if (offset !== undefined && length !== undefined) {
            const key = `${offset}-${length}`;
            if (openOffsets.has(key)) {
                details.open = true;
            }
        }
    });
}

// 編集後の再パース（アコーディオン状態を保持）
async function reparseAfterEdit(): Promise<void> {
    if (!editableData) return;
    
    // アコーディオン状態を保存
    const accordionState = saveAccordionState();
    
    // 現在のページインデックスを保存
    const pagingInput = document.querySelector<HTMLInputElement>('#paging-index-input');
    const currentPageIndex = pagingInput ? parseInt(pagingInput.value) || 0 : 0;
    
    // 再パース（editableDataはすでに更新済み）
    await parseAndDisplay();
    
    // ページインデックスを復元
    const newPagingInput = document.querySelector<HTMLInputElement>('#paging-index-input');
    if (newPagingInput && currentPageIndex > 0) {
        newPagingInput.value = currentPageIndex.toString();
        newPagingInput.dispatchEvent(new Event('input'));
    }
    
    // アコーディオン状態を復元
    restoreAccordionState(accordionState);
}

// パース結果を表示する関数
function displayParseResult(parseResult: BinaryRange): void {
    const maxPage = Math.ceil(parseResult.data.byteLength / bytesPerPage) - 1;
    const pagingControl = 
    `
    <label for="paging-index-input">Page</label>
    <input type="number" id="paging-index-input" value="0" min="0" max="${maxPage}"></input>
    <span id="display-range-text">(0 ~ ${bytesPerPage - 1}byte)</span>
    <label for="bytes-per-page-select" style="margin-left: 16px;">表示:</label>
    <select id="bytes-per-page-select">
        <option value="256" ${bytesPerPage === 256 ? 'selected' : ''}>256B</option>
        <option value="512" ${bytesPerPage === 512 ? 'selected' : ''}>512B</option>
        <option value="1024" ${bytesPerPage === 1024 ? 'selected' : ''}>1KB</option>
        <option value="2048" ${bytesPerPage === 2048 ? 'selected' : ''}>2KB</option>
        <option value="4096" ${bytesPerPage === 4096 ? 'selected' : ''}>4KB</option>
    </select>
    `
    document.querySelector<HTMLDivElement>('#hex-table-control')!.innerHTML = pagingControl;
    document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult);

    document.querySelector<HTMLDivElement>('.details-wrapper')!.innerHTML = toStructureHtmlString(parseResult);

    document.querySelector<HTMLElement>('#paging-index-input')!.addEventListener('input', (e) => {
        const pagingIndex = parseInt((e.target as HTMLInputElement).value);
        if (isNaN(pagingIndex))
        {
            return;
        }

        document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, pagingIndex);

        document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${pagingIndex * bytesPerPage} ~ ${(pagingIndex + 1) * bytesPerPage - 1}byte)`
    });

    // 表示バイト数変更
    document.querySelector<HTMLSelectElement>('#bytes-per-page-select')!.addEventListener('change', (e) => {
        const pagingInput = document.querySelector<HTMLInputElement>('#paging-index-input')!;
        const currentPage = parseInt(pagingInput.value) || 0;
        // 現在の表示開始オフセットを維持して新しいページを計算
        const currentOffset = currentPage * bytesPerPage;
        const newBytesPerPage = parseInt((e.target as HTMLSelectElement).value);
        bytesPerPage = newBytesPerPage;
        const newPage = Math.floor(currentOffset / bytesPerPage);
        const maxPage = Math.ceil(parseResult.data.byteLength / bytesPerPage) - 1;
        const adjustedPage = Math.min(newPage, maxPage);
        pagingInput.max = maxPage.toString();
        pagingInput.value = adjustedPage.toString();
        document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, adjustedPage);
        document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${adjustedPage * bytesPerPage} ~ ${(adjustedPage + 1) * bytesPerPage - 1}byte)`;
    });

    document.querySelector<HTMLElement>('.details-wrapper > details')!.addEventListener('keydown', (e) => {
        // キーボードの矢印キーで、detailsの開閉や移動を行う
        const detailsElement = (e.target as HTMLElement).closest("[data-offset]") as HTMLDetailsElement;
        if (e.key === "ArrowRight" )
        {
            detailsElement.open = true;
        }
        else if (e.key === "ArrowLeft")
        {
            if (detailsElement.open)
            {
                detailsElement.open = false;
            } else {
                const parentDetails = detailsElement.parentElement as HTMLDetailsElement;
                if (parentDetails && parentDetails.tagName === "DETAILS") {
                    parentDetails.querySelector("summary")?.focus();
                    parentDetails.click();
                }
            }
        }
        else if (e.key === "ArrowDown")
        {
            e.preventDefault();

            let next = detailsElement.open && detailsElement.querySelector<HTMLDetailsElement>('details')
                ? detailsElement.querySelector<HTMLDetailsElement>('details')
                : detailsElement.nextElementSibling as HTMLDetailsElement;

            if (next === null) {
                // 次の要素がない場合は、親の次の要素を探す
                next = detailsElement.parentElement?.nextElementSibling as HTMLDetailsElement;
            }

            if (next !== null) {
                next.querySelector("summary")?.focus();
                next.click();
            }
        }
        else if (e.key === "ArrowUp")
        {
            e.preventDefault();

            let prev = detailsElement.previousElementSibling as HTMLDetailsElement;

            if (prev === null || prev.tagName !== "DETAILS") {
                // 前の要素がない場合は、親の次の要素を探す
                prev = detailsElement.parentElement as HTMLDetailsElement;
            }

            if (prev !== null) {
                prev.querySelector("summary")?.focus();
                prev.click();
            }
        }

        // TODO同じように各矢印のキーイベントを自然に実装する
    });

    // 構造パネルのダブルクリック編集機能
    document.querySelector<HTMLElement>('.details-wrapper > details')!.addEventListener('dblclick', (e) => {
        const target = e.target as HTMLElement;
        
        // details要素（またはその中のsummary）をダブルクリックした場合
        const detailsElement = target.closest("[data-offset]") as HTMLElement;
        if (!detailsElement) return;
        
        const offset = parseInt(detailsElement.dataset.offset!);
        
        // Hexテーブルの該当ページに移動
        const nowPagingIndex = parseInt((document.querySelector("#paging-index-input") as HTMLInputElement).value);
        const targetPageIndex = Math.floor(offset / bytesPerPage);
        if (nowPagingIndex !== targetPageIndex) {
            document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, targetPageIndex);
            document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${targetPageIndex * bytesPerPage} ~ ${(targetPageIndex + 1) * bytesPerPage - 1}byte)`;
            document.querySelector<HTMLInputElement>('#paging-index-input')!.value = targetPageIndex.toString();
        }
        
        // 少し遅延させてからHexテーブルの該当セルの編集を開始
        setTimeout(() => {
            const targetTd = document.querySelector<HTMLTableCellElement>(`#hex-table td[data-offset="${offset}"]`);
            if (targetTd) {
                targetTd.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // さらに少し遅延させてから編集開始
                setTimeout(() => {
                    targetTd.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                }, 100);
            }
        }, 50);
    });

    document.querySelector<HTMLElement>('.details-wrapper > details')!.addEventListener('click', (e) => {
        console.log(e.target);
        if ((e.target as HTMLElement).classList.contains("cancel-toggle")) {
            // detailsの開閉の動作をキャンセルしたい
            e.preventDefault();
        }

        // クリックしたRangeに対応するTableの方の色付けをしたい
        let detailsElement = (e.target as HTMLElement).closest("[data-offset]") as HTMLElement;

        const offset = parseInt(detailsElement.dataset.offset!);
        const length = parseInt(detailsElement.dataset.length!);

        const nowPagingIndex = parseInt((document.querySelector("#paging-index-input") as HTMLInputElement).value);
        const clickedElementIndex = Math.floor(offset / bytesPerPage);
        if (nowPagingIndex !== clickedElementIndex)
        {
            document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, clickedElementIndex);
            document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${clickedElementIndex * bytesPerPage} ~ ${(clickedElementIndex + 1) * bytesPerPage - 1}byte)`
            document.querySelector<HTMLInputElement>('#paging-index-input')!.value = clickedElementIndex.toString();
        }

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parseResult, offset, length);
        highlightRangeList.shift(); // 最初の要素は全体なので削除

        // 色付け処理
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td'),
        ...document.querySelectorAll<HTMLElement>('.details-wrapper details')
        ].forEach(e => highlight(e, highlightRangeList));

        // クリックした構造に対応する箇所に、テーブルのスクロールを合わせる
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td')]
            .find(td => parseInt(td.dataset.offset!) === offset)?.scrollIntoView(
                {
                    behavior: 'smooth', 
                    block: 'center'
                }
            );
    });
}

// Hexテーブルのクリックイベントハンドラ（初期化時に一度だけ登録）
function setupHexTableEventListeners(): void {
    document.querySelector<HTMLElement>('#hex-table')!.addEventListener('click', (e) => {
        // テーブルをクリックしたときも同様に色付けする
        const target = e.target as HTMLElement;
        
        // td以外（th等）をクリックした場合は無視、編集中のinputも無視
        if (target.tagName !== 'TD' || !target.dataset.offset || target.querySelector('input')) {
            return;
        }
        
        // currentParseResultがない場合は何もしない
        if (!currentParseResult) {
            return;
        }
        
        const offset = parseInt(target.dataset.offset);

        // ハイライト対象のRangeを取得（全階層）
        const allRangeList: BinaryRange[] = getRangeContainsList(currentParseResult, offset);
        
        // 対応するアコーディオンを開く（親から子まで全階層）
        allRangeList.forEach(range => {
            const detailsElement = document.querySelector<HTMLDetailsElement>(
                `.details-wrapper details[data-offset="${range.data.byteOffset}"][data-length="${range.data.byteLength}"]`
            );
            if (detailsElement) {
                detailsElement.open = true;
            }
        });

        // ハイライト用のリストは最上層を除く
        const highlightRangeList = allRangeList.slice(1);

        // 色付け処理
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td'),
        ...document.querySelectorAll<HTMLElement>('.details-wrapper details')
        ].forEach(e => highlight(e, highlightRangeList));

        // クリックした構造に対応する箇所にスクロール
        const deepestDetails = [...document.querySelectorAll<HTMLElement>('.details-wrapper details')]
            .filter(d => parseInt(d.dataset.highlight!) > 0)
            .reduce((acc, details) => 
                parseInt(details.dataset.highlight!) >= parseInt(acc.dataset.highlight!) ? details : acc
            , document.querySelector<HTMLElement>('.details-wrapper details')!);
        
        if (deepestDetails) {
            deepestDetails.scrollIntoView({
                behavior: 'smooth', 
                block: 'center'
            });
        }
    });

    // Hexテーブルのダブルクリック編集機能
    document.querySelector<HTMLElement>('#hex-table')!.addEventListener('dblclick', (e) => {
        const target = e.target as HTMLElement;
        
        // td以外（th等）をダブルクリックした場合は無視
        if (target.tagName !== 'TD' || !target.dataset.offset) {
            return;
        }
        
        // 既に編集中の場合は無視
        if (target.querySelector('input')) {
            return;
        }
        
        const offset = parseInt(target.dataset.offset);
        const originalValue = target.textContent?.trim() || '00';
        
        // インライン入力フィールドを作成
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.maxLength = 2;
        input.className = 'hex-edit-input';
        input.style.width = '2ch';
        input.style.textAlign = 'center';
        input.style.fontFamily = 'monospace';
        input.style.border = '1px solid #1a73e8';
        input.style.borderRadius = '2px';
        input.style.padding = '0';
        input.style.margin = '0';
        input.style.fontSize = 'inherit';
        input.style.textTransform = 'uppercase';
        
        target.textContent = '';
        target.appendChild(input);
        input.focus();
        input.select();
        
        const commitEdit = (newValue: string) => {
            const hex = newValue.toUpperCase().padStart(2, '0');
            // 16進数として有効かチェック
            if (!/^[0-9A-F]{1,2}$/i.test(newValue)) {
                // 無効な値の場合は元に戻す
                target.textContent = originalValue;
                return;
            }
            
            const byteValue = parseInt(hex, 16);
            if (byteValue < 0 || byteValue > 255) {
                target.textContent = originalValue;
                return;
            }
            
            // editableDataを更新
            if (editableData) {
                editableData[offset] = byteValue;
            }
            
            target.textContent = hex;
            
            // 値が変更された場合は再パースをスケジュール（連続編集中は遅延）
            if (hex !== originalValue) {
                return true; // 変更あり
            }
            return false; // 変更なし
        };
        
        const cancelEdit = () => {
            target.textContent = originalValue;
        };
        
        // 編集終了時に再パースを実行するフラグ
        let shouldReparse = false;
        let isMovingToNext = false;
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const changed = commitEdit(input.value);
                if (changed) shouldReparse = true;
                
                // Tab/Enterで次のセルに移動して編集
                isMovingToNext = true;
                const nextOffset = offset + 1;
                const nextTd = document.querySelector<HTMLTableCellElement>(`#hex-table td[data-offset="${nextOffset}"]`);
                if (nextTd) {
                    // 次のセルをダブルクリックしたように編集を開始
                    nextTd.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                } else {
                    // 次のセルがない場合は再パース実行
                    if (shouldReparse) {
                        reparseAfterEdit();
                    }
                }
            } else if (e.key === 'Escape') {
                cancelEdit();
                // Escapeで編集終了時は再パース実行
                if (shouldReparse) {
                    reparseAfterEdit();
                }
            }
        });
        
        input.addEventListener('blur', () => {
            // blurで確定（他の場所をクリックした場合）
            if (target.contains(input)) {
                const changed = commitEdit(input.value);
                if (changed) shouldReparse = true;
                
                // 次のセルへの移動ではない場合のみ再パース
                if (!isMovingToNext && shouldReparse) {
                    reparseAfterEdit();
                }
            }
        });
        
        // 2文字入力されたら自動的に次へ
        input.addEventListener('input', () => {
            if (input.value.length >= 2 && /^[0-9A-Fa-f]{2}$/.test(input.value)) {
                const changed = commitEdit(input.value);
                if (changed) shouldReparse = true;
                
                isMovingToNext = true;
                const nextOffset = offset + 1;
                const nextTd = document.querySelector<HTMLTableCellElement>(`#hex-table td[data-offset="${nextOffset}"]`);
                if (nextTd) {
                    nextTd.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                } else {
                    // 次のセルがない場合は再パース実行
                    if (shouldReparse) {
                        reparseAfterEdit();
                    }
                }
            }
        });
    });
}

const getRangeContainsList = (range: BinaryRange, offset: number, length: number = 1): BinaryRange[] =>
    range.contains(offset, length)
        ? range.subRanges.reduce(
            (acc, child) => [...acc, ...getRangeContainsList(child, offset, length)]
            , [range]
        )
        : [];

// 初期化時にHexテーブルのイベントリスナーを登録
setupHexTableEventListeners();


const highlight = (element: HTMLElement, highlightRangeList: BinaryRange[]) => {
    if (element.dataset.offset === undefined)
        return;
    const offset = parseInt(element.dataset.offset!);

    const length = element.dataset.length !== undefined
        ? parseInt(element.dataset.length!)
        : 1;

    const matchingRanges = highlightRangeList.filter(range => range.contains(offset, length));
    const highlightCount = matchingRanges.length;
    element.dataset.highlight = highlightCount.toString();
    
    // Hexのセル（TD要素）にツールチップを設定
    if (element.tagName === 'TD' && highlightCount > 0) {
        const deepestRange = matchingRanges[matchingRanges.length - 1];
        let titleText = deepestRange.name;
        if (deepestRange.doc) {
            titleText += `\n\n${deepestRange.doc}`;
        }
        element.title = titleText;
    }
}

// XSS対策: HTMLエスケープ関数
const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const byteToString = (byte: number) => byte.toString(16).padStart(2, '0').toUpperCase();
const toHexTableHtmlString = (hexRange: BinaryRange, pageIndex: number = 0): string => {
    const displayArray = hexRange.data.subarray(pageIndex * bytesPerPage, (pageIndex + 1) * bytesPerPage);
    const offset = hexRange.data.byteOffset + (pageIndex * bytesPerPage);
    return `
            <div class="table-wrapper">
            <table class="table table-sm table-bordered">
                <thead>
                    <tr>
                        <th>Pos</th>
                        ${[...Array(16)].map((_, i) => i).reduce((acc, b) => acc + `<th>${b.toString(16).toUpperCase()}</th>`, "")}
                    </tr>
                </thead>
                    ${
                        chunk(displayArray, 16)
                            .reduce((acc, r, rowIndex) =>
                                acc + `<tr>
                                            <th>
                                                ${(rowIndex + (pageIndex * bytesPerPage / 16)).toString(16).toUpperCase()}
                                            </th>
                                                ${r.reduce((acc2, b, colIndex) => 
                                                    acc2 + `<td data-offset="${rowIndex * 16 + colIndex + offset}" 
                                                                data-highlight="0">
                                                                ${byteToString(b)}
                                                            </td>`, "")}
                                        </tr>`,
                                "")
                    }
            </table>
            </div>
        `;
}

const toStructureHtmlString = (segment: BinaryRange): string => {
    const titleAttr = segment.doc ? ` title="${escapeHtml(segment.doc)}"` : '';
    return `
<details data-offset="${segment.data.byteOffset}" data-length="${segment.data.byteLength}" data-highlight="0"${titleAttr}>
  <summary><span class="cancel-toggle"> ${escapeHtml(segment.name)} (${rangeToString(segment)})</span></summary>
    ${escapeHtml(segment.interpret())}
    ${segment.subRanges.reduce((acc, child) => acc + toStructureHtmlString(child), "")}
</details>
`;
}

const rangeToString = (range: BinaryRange): string => {
    if (range.data.byteLength === 0) {
        return "-"
    }

    const startIndex = range.data.byteOffset;
    const endIndex = startIndex + range.data.byteLength;
    return `${byteToString(startIndex)} ～ ${byteToString(endIndex - 1)}`;
}

// ==========================================
// テキスト入力からのパース処理
// ==========================================
let textParseTimeout: number | null = null;
document.querySelector<HTMLTextAreaElement>('#hex-text-input')?.addEventListener('input', async (e) => {
    const textarea = e.target as HTMLTextAreaElement;
    const text = textarea.value;
    
    if (textParseTimeout) clearTimeout(textParseTimeout);
    
    // 連続入力を防ぐため、300msデバウンスしてパース実行
    textParseTimeout = window.setTimeout(async () => {
        if (!text.trim()) {
            clearError();
            return;
        }

        // 空白文字（スペース、タブ、改行等）を削除
        const cleanedText = text.replace(/\s+/g, '');

        // 16進数として有効かチェック（0-9, a-f, A-F のみ、かつ偶数長）
        if (!/^[0-9A-Fa-f]+$/.test(cleanedText)) {
            showError('無効な文字が含まれています。16進数（0-9, A-F）のみ入力してください');
            return;
        }
        if (cleanedText.length % 2 !== 0) {
            showError('文字数は偶数になるように入力してください（例: "01 02" は4文字なのでOK、"01 2" は3文字なのでNG）');
            return;
        }

        clearError();
        try {
            const byteLength = cleanedText.length / 2;
            const arrayBuffer = new ArrayBuffer(byteLength);
            const view = new Uint8Array(arrayBuffer);

            for (let i = 0; i < byteLength; i++) {
                view[i] = parseInt(cleanedText.substring(i * 2, i * 2 + 2), 16);
            }

            currentFileName = '[Text Input]';
            editableData = view;
            
            document.querySelector<HTMLSpanElement>('#current-file-name')!.textContent = `📄 ${currentFileName}`;
            document.querySelector<HTMLButtonElement>('#download-btn')!.disabled = false;
            
            updateExtMappingInfo();
            
            await parseAndDisplay();
        } catch (e) {
            showError(`テキストパースエラー: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, 300);
});

// ==========================================
// KSY GUIビルダーのロジック
// ==========================================
const tabRaw = document.querySelector<HTMLButtonElement>('#ksy-tab-raw');
const tabGui = document.querySelector<HTMLButtonElement>('#ksy-tab-gui');
const rawEditor = document.querySelector<HTMLDivElement>('#ksy-raw-editor');
const guiEditor = document.querySelector<HTMLDivElement>('#ksy-gui-editor');
const guiFieldsContainer = document.querySelector<HTMLDivElement>('#ksy-gui-fields');
const guiAddFieldBtn = document.querySelector<HTMLButtonElement>('#ksy-gui-add-field-btn');
const guiEndianSelect = document.querySelector<HTMLSelectElement>('#ksy-gui-endian');
const ksySaveNameInput = document.querySelector<HTMLInputElement>('#ksy-save-name');
const ksyTextArea = document.querySelector<HTMLTextAreaElement>('#ksyText');

if (tabRaw && tabGui && rawEditor && guiEditor && guiFieldsContainer && guiAddFieldBtn) {
    // タブ切り替え
    tabRaw.addEventListener('click', () => {
        // GUIからYAMLへ同期
        if (typeof (window as any).generateYamlFromGui === 'function') {
            const yaml = (window as any).generateYamlFromGui(true); // silent = true
            if (yaml !== null) {
                ksyTextArea!.value = yaml;
            }
        }

        tabRaw.classList.add('active');
        tabGui.classList.remove('active');
        tabRaw.style.background = '#1a73e8';
        tabRaw.style.color = 'white';
        tabRaw.style.border = '1px solid #1a73e8';
        tabGui.style.background = '#f5f5f5';
        tabGui.style.color = 'black';
        tabGui.style.border = '1px solid #ccc';
        rawEditor.style.display = 'flex';
        guiEditor.style.display = 'none';
    });

    tabGui.addEventListener('click', () => {
        // YAMLからGUIへ同期
        try {
            const yamlText = ksyTextArea!.value.trim();
            if (yamlText) {
                const schema = parseKsySchema(yamlText);
                
                // メタ情報の同期
                if (ksySaveNameInput && schema.meta.id) {
                    ksySaveNameInput.value = schema.meta.id;
                }
                if (guiEndianSelect && schema.meta.endian) {
                    guiEndianSelect.value = schema.meta.endian;
                }
                
                // フィールドの同期
                if (schema.seq && Array.isArray(schema.seq)) {
                    guiFieldsContainer!.innerHTML = '';
                    schema.seq.forEach((field: any) => {
                        const row = createGuiFieldRow();
                        
                        const idInput = row.querySelector<HTMLInputElement>('.field-id');
                        const typeInput = row.querySelector<HTMLInputElement>('.field-type');
                        const sizeInput = row.querySelector<HTMLInputElement>('.field-size');
                        const repeatInput = row.querySelector<HTMLInputElement>('.field-repeat');
                        const docInput = row.querySelector<HTMLTextAreaElement>('.field-doc');
                        
                        if (idInput && field.id) idInput.value = field.id;
                        if (typeInput && field.type) {
                            typeInput.value = field.type;
                        }
                        if (sizeInput) {
                            if (field.type === 'str' || field.type === 'strz') {
                                sizeInput.disabled = false;
                                sizeInput.value = field.size !== undefined ? String(field.size) : '';
                            }
                        }
                        if (repeatInput && field.repeat === 'expr' && field.repeatExpr !== undefined) {
                            repeatInput.value = String(field.repeatExpr);
                        }
                        if (docInput && field.doc) {
                            docInput.value = field.doc;
                        }
                        
                        guiFieldsContainer!.appendChild(row);
                    });
                }
                
                // フィールドが空の場合は1行追加
                if (guiFieldsContainer!.children.length === 0) {
                    guiFieldsContainer!.appendChild(createGuiFieldRow());
                }
                
                // 初回バリデーションを実行
                validateGuiFields();
            }
            
            // datalist（オートコンプリート）の更新
            let dataList = document.getElementById('type-options');
            if (!dataList) {
                dataList = document.createElement('datalist');
                dataList.id = 'type-options';
                document.body.appendChild(dataList);
            }
            const customSchemas = listKsyNames();
            dataList.innerHTML = `
                <option value="u1">符号なし1byte</option>
                <option value="u2">符号なし2byte</option>
                <option value="u4">符号なし4byte</option>
                <option value="s1">符号あり1byte</option>
                <option value="s2">符号あり2byte</option>
                <option value="s4">符号あり4byte</option>
                <option value="str">文字列</option>
                <option value="strz">NULL終端文字列</option>
                ${customSchemas.map(name => `<option value="${name}">保存済みスキーマ</option>`).join('')}
            `;
            
        } catch (e) {
            if (!confirm('YAMLのパースエラーがあるため、GUIに正しく同期できません。このままGUIを開きますか？\nエラー: ' + (e instanceof Error ? e.message : String(e)))) {
                return;
            }
        }

        tabGui.classList.add('active');
        tabRaw.classList.remove('active');
        tabGui.style.background = '#1a73e8';
        tabGui.style.color = 'white';
        tabGui.style.border = '1px solid #1a73e8';
        tabRaw.style.background = '#f5f5f5';
        tabRaw.style.color = 'black';
        tabRaw.style.border = '1px solid #ccc';
        guiEditor.style.display = 'flex';
        rawEditor.style.display = 'none';
    });

    // フィールド行のHTMLを生成
    // GUIのバリデーションをリアルタイムに行う関数
    const validateGuiFields = () => {
        if (!guiFieldsContainer) return;
        
        const rows = Array.from(guiFieldsContainer.children);
        const allFieldIds = rows.map(rowElement => {
            const input = (rowElement as HTMLElement).querySelector<HTMLInputElement>('.field-id');
            return input ? input.value.trim() : '';
        }).filter(id => id !== '');

        rows.forEach(rowElement => {
            const row = rowElement as HTMLElement;
            const repeatInput = row.querySelector<HTMLInputElement>('.field-repeat');
            if (repeatInput) {
                const val = repeatInput.value.trim();
                if (val !== '') {
                    // 数値か、または他のフィールド名に存在するかチェック
                    const isNumber = /^\d+$/.test(val);
                    if (!isNumber && !allFieldIds.includes(val)) {
                        repeatInput.style.borderColor = '#d32f2f';
                        repeatInput.style.backgroundColor = '#ffebee';
                        repeatInput.title = 'エラー: 数値または存在する他のフィールド名を入力してください';
                    } else {
                        repeatInput.style.borderColor = '#ccc';
                        repeatInput.style.backgroundColor = '#fff';
                        repeatInput.title = '配列にする場合の繰り返し回数（固定値またはフィールド名）';
                    }
                } else {
                    repeatInput.style.borderColor = '#ccc';
                    repeatInput.style.backgroundColor = '#fff';
                    repeatInput.title = '配列にする場合の繰り返し回数（固定値またはフィールド名）';
                }
            }
        });
    };

    if (guiFieldsContainer) {
        guiFieldsContainer.addEventListener('input', validateGuiFields);
    }

    const createGuiFieldRow = (): HTMLDivElement => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        row.style.alignItems = 'center';
        row.style.background = '#fff';
        row.style.padding = '6px';
        row.style.border = '1px solid #e0e0e0';
        row.style.borderRadius = '4px';

        row.innerHTML = `
            <div style="display: flex; flex-direction: column; flex: 1; gap: 4px;">
                <div style="display: flex; gap: 6px; align-items: center;">
                    <input type="text" class="field-id" placeholder="id (例: magic)" style="flex: 2; min-width: 80px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;" />
                    <input type="text" list="type-options" class="field-type" placeholder="type (例: u1, png)" style="flex: 2; min-width: 80px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;" />
                    <input type="text" class="field-size" placeholder="size" disabled style="flex: 1; min-width: 40px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;" title="文字列等のサイズ指定(数値または式)" />
                    <input type="text" class="field-repeat" placeholder="回数 (任意)" style="flex: 1; min-width: 40px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;" title="配列にする場合の繰り返し回数（固定値またはフィールド名）" />
                    <button class="field-delete-btn" style="padding: 4px 8px; background: #ffebee; color: #d32f2f; border: 1px solid #ffcdd2; border-radius: 4px; cursor: pointer;">✕</button>
                </div>
                <textarea class="field-doc" placeholder="説明 (改行可能)" rows="2" style="width: 100%; min-height: 0 !important; flex: none !important; resize: vertical; padding: 4px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 11px; font-family: sans-serif; line-height: 1.3;"></textarea>
            </div>
        `;

        // 型がstr/strzの場合はsizeを有効化
        const typeInput = row.querySelector<HTMLInputElement>('.field-type')!;
        const sizeInput = row.querySelector<HTMLInputElement>('.field-size')!;
        typeInput.addEventListener('change', () => {
            if (typeInput.value === 'str' || typeInput.value === 'strz') {
                sizeInput.disabled = false;
            } else {
                sizeInput.disabled = true;
                sizeInput.value = '';
            }
        });

        // 削除ボタン
        row.querySelector('.field-delete-btn')!.addEventListener('click', () => {
            row.remove();
        });

        return row;
    };

    // 初期フィールドを1つ追加
    guiFieldsContainer.appendChild(createGuiFieldRow());

    // フィールド追加ボタン
    guiAddFieldBtn.addEventListener('click', () => {
        guiFieldsContainer.appendChild(createGuiFieldRow());
    });

    // GUIからYAMLを生成する関数（グローバルにエクスポートして保存ボタンからも呼べるようにする）
    (window as any).generateYamlFromGui = (silent: boolean = false): string | null => {
        const id = ksySaveNameInput?.value.trim() || 'my_format';
        const endian = guiEndianSelect?.value || 'le';
        
        let yaml = `meta:
  id: ${id}
  endian: ${endian}
seq:
`;

        const rows = Array.from(guiFieldsContainer.children);
        if (rows.length === 0) {
            if (!silent) alert('フィールドがありません');
            return null;
        }

        // 事前にすべてのフィールドIDを収集
        const allFieldIds = rows.map(rowElement => {
            const input = (rowElement as HTMLElement).querySelector<HTMLInputElement>('.field-id');
            return input ? input.value.trim() : '';
        }).filter(id => id !== '');

        let hasError = false;
        rows.forEach(rowElement => {
            const row = rowElement as HTMLElement;
            const fieldIdInput = row.querySelector<HTMLInputElement>('.field-id');
            const fieldTypeInput = row.querySelector<HTMLInputElement>('.field-type');
            const fieldSizeInput = row.querySelector<HTMLInputElement>('.field-size');
            const fieldRepeatInput = row.querySelector<HTMLInputElement>('.field-repeat');
            const fieldDocInput = row.querySelector<HTMLTextAreaElement>('.field-doc');
            
            if (!fieldIdInput || !fieldTypeInput) return;

            const fieldId = fieldIdInput.value.trim();
            const fieldType = fieldTypeInput.value.trim();
            const fieldSize = fieldSizeInput ? fieldSizeInput.value.trim() : '';
            const fieldRepeat = fieldRepeatInput ? fieldRepeatInput.value.trim() : '';
            const fieldDoc = fieldDocInput ? fieldDocInput.value.trim() : '';

            if (!fieldId) {
                if (!silent) hasError = true;
                return; // サイレント同期時は空の行を無視する
            }

            yaml += `  - id: ${fieldId}\n    type: ${fieldType}\n`;
            
            if (fieldRepeat) {
                const isNumber = /^\d+$/.test(fieldRepeat);
                if (!isNumber && !allFieldIds.includes(fieldRepeat)) {
                    if (!silent) {
                        alert(`フィールド "${fieldId}" の回数指定 "${fieldRepeat}" が不正です。\n数値、または存在する他のフィールド名を入力してください。`);
                        hasError = true;
                    }
                }
                yaml += `    repeat: expr\n    repeat-expr: ${fieldRepeat}\n`;
            }
            
            if (fieldDoc) {
                const indentedDoc = fieldDoc.split('\n').map(line => `      ${line}`).join('\n');
                yaml += `    doc: |\n${indentedDoc}\n`;
            }

            if (fieldType === 'str') {
                if (!fieldSize) {
                    if (!silent) {
                        alert(`フィールド "${fieldId}" (str) にはサイズ(数値またはフィールド参照)が必要です。`);
                        hasError = true;
                    }
                } else {
                    yaml += `    size: ${fieldSize}\n    encoding: UTF-8\n`;
                }
            }
        });

        if (hasError && !silent) {
            if (!confirm('一部のフィールド名が空、またはエラーがあります。このままYAMLに変換しますか？')) {
                return null;
            }
        }

        return yaml;
    };
}