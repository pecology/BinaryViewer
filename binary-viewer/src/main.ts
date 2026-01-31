import './style.css'
import { ZipParser } from './zipParser.ts'
import { TextParser } from './textParser.ts'
import { parseKsySchema, parseBinary } from './ksy/DynamicParser.ts'
import { saveKsy, loadKsy, deleteKsy, listKsyNames, hasKsy } from './ksyStorage.ts'
import { saveExtensionMapping, getParserForExtension, getExtensionFromFileName, type ParserType } from './extensionMapping.ts'
import type { BinaryRange } from './BinaryRange.ts'

// 現在読み込んでいるバイナリデータ
let currentData: ArrayBuffer | null = null;
let currentFileName: string = '';
// 編集可能なバイナリデータ（Uint8Arrayで直接編集可能）
let editableData: Uint8Array | null = null;

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
      <div id="current-file-name" class="current-file-name"></div>
      <div class="download-section">
          <button id="download-btn" disabled>💾 ダウンロード</button>
      </div>
      <div class="parser-section">
          <label>パーサー:</label>
          <select id="parser-select">
              <option value="zip">ZIP Parser</option>
              <option value="text">Text Parser</option>
              <option value="ksy">KSY (Custom Schema)</option>
          </select>
          <button id="link-ext-btn" title="この拡張子に紐づける">🔗 拡張子に紐づけ</button>
          <div id="ext-mapping-info" class="ext-mapping-info"></div>
      </div>
      <div id="ksy-input" class="ksy-input" style="display: none;">
          <div class="ksy-storage-row">
              <label>保存済み:</label>
              <select id="ksy-saved-select">
                  <option value="">-- 選択 --</option>
              </select>
              <button id="ksy-load-btn" title="読み込み">📂</button>
              <button id="ksy-delete-btn" title="削除">🗑️</button>
          </div>
          <div class="ksy-file-row">
              <label>ファイル:</label>
              <input type="file" id="ksyFileInput" accept=".ksy,.yaml,.yml" />
          </div>
          <div class="ksy-save-row">
              <input type="text" id="ksy-save-name" placeholder="スキーマ名" />
              <button id="ksy-save-btn">💾</button>
          </div>
          <textarea id="ksyText" placeholder="meta:\n  id: my_format\n  endian: le\nseq:\n  - id: magic\n    type: u4"></textarea>
      </div>
      <div id="error-message" class="error-message"></div>
    </div>
    <div class="panel hex-panel">
      <h3>Hex <span id="edit-hint" class="edit-hint">(ダブルクリックで編集)</span></h3>
      <div id="hex-table-control"></div>
      <div id="hex-table"></div>
    </div>
    <div class="panel structure-panel">
      <h3>構造</h3>
      <div class="details-wrapper"></div>
    </div>
  </div>
`;

// パーサー選択時にKSY入力欄の表示を切り替え & 再パース
document.querySelector<HTMLSelectElement>('#parser-select')!.addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    const ksyInput = document.querySelector<HTMLDivElement>('#ksy-input')!;
    ksyInput.style.display = select.value === 'ksy' ? 'block' : 'none';
    
    // データがあれば再パース
    if (currentData) {
        parseAndDisplay();
    }
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

// 現在のパーサー設定値を取得（KSY選択時はスキーマ名も含める）
function getCurrentParserValue(): ParserType {
    const parserSelect = document.querySelector<HTMLSelectElement>('#parser-select')!;
    const parserType = parserSelect.value;
    if (parserType === 'ksy') {
        const ksySavedSelect = document.querySelector<HTMLSelectElement>('#ksy-saved-select')!;
        const ksyName = ksySavedSelect.value;
        if (ksyName) {
            return `ksy:${ksyName}`;
        }
        return 'ksy:';
    }
    return parserType as ParserType;
}

// パーサーを設定する（拡張子マッピングからの自動選択時に使用）
function setParser(parser: ParserType): void {
    const parserSelect = document.querySelector<HTMLSelectElement>('#parser-select')!;
    const ksyInput = document.querySelector<HTMLDivElement>('#ksy-input')!;
    
    if (parser.startsWith('ksy:')) {
        parserSelect.value = 'ksy';
        ksyInput.style.display = 'block';
        const ksyName = parser.substring(4);
        if (ksyName) {
            const ksySavedSelect = document.querySelector<HTMLSelectElement>('#ksy-saved-select')!;
            ksySavedSelect.value = ksyName;
            const content = loadKsy(ksyName);
            if (content) {
                document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = content;
                document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = ksyName;
            }
        }
    } else {
        parserSelect.value = parser;
        ksyInput.style.display = 'none';
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
        currentData = await file.arrayBuffer();
        currentFileName = file.name;
        // 編集可能なUint8Arrayを作成
        editableData = new Uint8Array(currentData.slice(0));
        
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
    alert(`拡張子 "${ext}" を "${parserValue}" に紐づけました`);
});

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
        // KSYが変更されたら再パース
        if (currentData) {
            parseAndDisplay();
        }
    }
});

// 保存済みKSY一覧を更新
function updateKsySavedList(): void {
    const select = document.querySelector<HTMLSelectElement>('#ksy-saved-select')!;
    const names = listKsyNames();
    select.innerHTML = '<option value="">-- 選択してください --</option>' +
        names.map(name => `<option value="${name}">${name}</option>`).join('');
}

// 初期化時に一覧を更新
updateKsySavedList();

// 保存済みKSYを読み込み
document.querySelector<HTMLButtonElement>('#ksy-load-btn')!.addEventListener('click', () => {
    const select = document.querySelector<HTMLSelectElement>('#ksy-saved-select')!;
    const name = select.value;
    if (!name) {
        alert('スキーマを選択してください');
        return;
    }
    const content = loadKsy(name);
    if (content) {
        document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = content;
        document.querySelector<HTMLInputElement>('#ksy-save-name')!.value = name;
        // KSYが変更されたら再パース
        if (currentData) {
            parseAndDisplay();
        }
    }
});

// 保存済みKSYを削除
document.querySelector<HTMLButtonElement>('#ksy-delete-btn')!.addEventListener('click', () => {
    const select = document.querySelector<HTMLSelectElement>('#ksy-saved-select')!;
    const name = select.value;
    if (!name) {
        alert('削除するスキーマを選択してください');
        return;
    }
    if (confirm(`"${name}" を削除しますか？`)) {
        deleteKsy(name);
        updateKsySavedList();
    }
});

// KSYを保存
document.querySelector<HTMLButtonElement>('#ksy-save-btn')!.addEventListener('click', () => {
    const nameInput = document.querySelector<HTMLInputElement>('#ksy-save-name')!;
    const textArea = document.querySelector<HTMLTextAreaElement>('#ksyText')!;
    const name = nameInput.value.trim();
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
    
    saveKsy(name, content);
    updateKsySavedList();
    alert(`"${name}" を保存しました`);
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
    
    if (!currentData) {
        return;
    }
    
    const parserType = parserSelect.value;
    
    let parseResult: BinaryRange;
    try {
        switch (parserType) {
            case 'zip':
                parseResult = ZipParser.parse(new Uint8Array(currentData));
                break;
            case 'text':
                parseResult = TextParser.parse(new Uint8Array(currentData));
                break;
            case 'ksy': {
                const ksyText = document.querySelector<HTMLTextAreaElement>('#ksyText')!.value.trim();
                if (!ksyText) {
                    showError('KSYスキーマを入力してください');
                    return;
                }
                const schema = parseKsySchema(ksyText);
                const result = parseBinary(currentData, schema);
                if (result.warnings.length > 0) {
                    console.warn('Parse warnings:', result.warnings);
                }
                parseResult = result.root;
                break;
            }
            default:
                showError('不明なパーサータイプ');
                return;
        }
    } catch (e) {
        showError(`パースエラー: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    
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
    if (!editableData || !currentData) return;
    
    // アコーディオン状態を保存
    const accordionState = saveAccordionState();
    
    // 現在のページインデックスを保存
    const pagingInput = document.querySelector<HTMLInputElement>('#paging-index-input');
    const currentPageIndex = pagingInput ? parseInt(pagingInput.value) || 0 : 0;
    
    // editableDataを元にcurrentDataを更新（ArrayBufferとして新しいコピーを作成）
    currentData = new Uint8Array(editableData).buffer;
    
    // 再パース
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
    const pagingControl = 
    `
    <label for="paging-index-input">Offset</label>
    <input type="number" id="paging-index-input" value="0" min="0" max="${parseResult.data.byteLength / 1024}"></input>
    <span id="display-range-text">(0 ~ 1023byte)</span>
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

        document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${pagingIndex * 1024} ~ ${(pagingIndex + 1) * 1024 -1}byte)`
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
        const targetPageIndex = Math.floor(offset / 1024);
        if (nowPagingIndex !== targetPageIndex) {
            document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, targetPageIndex);
            document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${targetPageIndex * 1024} ~ ${(targetPageIndex + 1) * 1024 - 1}byte)`;
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
        const clickedElementIndex = Math.floor(offset / 1024);
        if (nowPagingIndex !== clickedElementIndex)
        {
            document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, clickedElementIndex);
            document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${clickedElementIndex * 1024} ~ ${(clickedElementIndex + 1) * 1024 -1}byte)`
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

    document.querySelector<HTMLElement>('#hex-table')!.addEventListener('click', (e) => {
        // テーブルをクリックしたときも同様に色付けする
        const target = e.target as HTMLElement;
        
        // td以外（th等）をクリックした場合は無視、編集中のinputも無視
        if (target.tagName !== 'TD' || !target.dataset.offset || target.querySelector('input')) {
            return;
        }
        
        const offset = parseInt(target.dataset.offset);

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parseResult, offset);
        highlightRangeList.shift(); // 最初の要素は全体なので削除

        // 色付け処理
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td'),
        ...document.querySelectorAll<HTMLElement>('.details-wrapper details')
        ].forEach(e => highlight(e, highlightRangeList));

        // クリックした構造に対応する箇所に、テーブルのスクロールを合わせる
        [...document.querySelectorAll<HTMLElement>('.details-wrapper details')]
            .reduce((acc, details) => parseInt(details.dataset.highlight!) >= parseInt(acc.dataset.highlight!) ? details : acc)
            .scrollIntoView(
                {
                    behavior: 'smooth', 
                    block: 'center'
                }
            );

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


const highlight = (element: HTMLElement, highlightRangeList: BinaryRange[]) => {
    if (element.dataset.offset === undefined)
        return;
    const offset = parseInt(element.dataset.offset!);

    const length = element.dataset.length !== undefined
        ? parseInt(element.dataset.length!)
        : 1;

    const highlightCount = highlightRangeList.filter(range => range.contains(offset, length))
        .length;
    element.dataset.highlight = highlightCount.toString();
}

// XSS対策: HTMLエスケープ関数
const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const byteToString = (byte: number) => byte.toString(16).padStart(2, '0').toUpperCase();
const toHexTableHtmlString = (hexRange: BinaryRange, pageIndex: number = 0): string => {
    const displayArray = hexRange.data.subarray(pageIndex * 1024, (pageIndex + 1) * 1024);
    const offset = hexRange.data.byteOffset + (pageIndex * 1024);
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
                                                ${(rowIndex + (pageIndex * 1024 / 16)).toString(16).toUpperCase()}
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
    return `
<details data-offset="${segment.data.byteOffset}" data-length="${segment.data.byteLength}" data-highlight="0">
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