import './style.css'
import { ZipParser } from './zipParser.ts'
import { TextParser } from './textParser.ts'
import { parseKsySchema, parseBinary } from './ksy/DynamicParser.ts'
import { saveKsy, loadKsy, deleteKsy, listKsyNames, hasKsy } from './ksyStorage.ts'
import type { BinaryRange } from './BinaryRange.ts'

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
  <div class="input">
    <div class="input-row">
        <input type="file" id="fileInput" />
        <select id="parser-select">
            <option value="zip">ZIP Parser</option>
            <option value="text">Text Parser</option>
            <option value="ksy">KSY (Custom Schema)</option>
        </select>
        <button id="load-button">Load File</button>
    </div>
    <div id="ksy-input" class="ksy-input" style="display: none;">
        <div class="ksy-storage-row">
            <label>保存済みスキーマ:</label>
            <select id="ksy-saved-select">
                <option value="">-- 選択してください --</option>
            </select>
            <button id="ksy-load-btn" title="読み込み">📂</button>
            <button id="ksy-delete-btn" title="削除">🗑️</button>
        </div>
        <div class="ksy-file-row">
            <label for="ksyFileInput">ファイルから読み込み:</label>
            <input type="file" id="ksyFileInput" accept=".ksy,.yaml,.yml" />
        </div>
        <div class="ksy-save-row">
            <label for="ksy-save-name">名前を付けて保存:</label>
            <input type="text" id="ksy-save-name" placeholder="スキーマ名" />
            <button id="ksy-save-btn">💾 保存</button>
        </div>
        <span class="ksy-hint">スキーマ定義 (YAML):</span>
        <textarea id="ksyText" placeholder="meta:\n  id: my_format\n  endian: le\nseq:\n  - id: magic\n    type: u4"></textarea>
    </div>
    <div id="error-message" class="error-message"></div>
  </div>
`;

// パーサー選択時にKSY入力欄の表示を切り替え
document.querySelector<HTMLSelectElement>('#parser-select')!.addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    const ksyInput = document.querySelector<HTMLDivElement>('#ksy-input')!;
    ksyInput.style.display = select.value === 'ksy' ? 'block' : 'none';
});

// KSYファイル読み込み時にテキストエリアに反映
document.querySelector<HTMLInputElement>('#ksyFileInput')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
        const text = await input.files[0].text();
        document.querySelector<HTMLTextAreaElement>('#ksyText')!.value = text;
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

document.querySelector<HTMLButtonElement>('#load-button')!.addEventListener('click', async () => {
    const fileInput = document.querySelector<HTMLInputElement>('#fileInput')!;
    const parserSelect = document.querySelector<HTMLSelectElement>('#parser-select')!;
    clearError();
    
    // ファイル未選択チェック
    if (!fileInput.files || fileInput.files.length === 0) {
        showError('ファイルを選択してください');
        return;
    }
    
    const file = fileInput.files[0];
    const parserType = parserSelect.value;
    
    let parseResult: BinaryRange;
    try {
        const data = await file.arrayBuffer();
        
        switch (parserType) {
            case 'zip':
                parseResult = ZipParser.parse(new Uint8Array(data));
                break;
            case 'text':
                parseResult = TextParser.parse(new Uint8Array(data));
                break;
            case 'ksy': {
                const ksyText = document.querySelector<HTMLTextAreaElement>('#ksyText')!.value.trim();
                if (!ksyText) {
                    showError('KSYスキーマを入力してください');
                    return;
                }
                const schema = parseKsySchema(ksyText);
                const result = parseBinary(data, schema);
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
    
    // document.querySelector<HTMLDivElement>('#app')!.insertAdjacentHTML("beforeend",`
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
        <div id="output">
            <div id="left" class = "col">
                <div id="hex-table-control">
                </div>
                <div id="hex-table">
                </div>
            </div>
            <div id="hex-structure" class="col">
                <div class="details-wrapper">
                </div>
            </div>
        </div>`;
    
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
            .find(td => parseInt(td.dataset.offset!) === offset)!.scrollIntoView(
                {
                    behavior: 'smooth', 
                    block: 'center'
                }
            );
    });

    document.querySelector<HTMLElement>('#hex-table')!.addEventListener('click', (e) => {
        // テーブルをクリックしたときも同様に色付けする
        const target = e.target as HTMLElement;
        
        // td以外（th等）をクリックした場合は無視
        if (target.tagName !== 'TD' || !target.dataset.offset) {
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
});

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