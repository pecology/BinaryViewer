/**
 * 配列（繰り返しフィールド）の表形式表示
 *
 * 構造ビューの配列ノードの「表で表示」から開くモーダル。
 * 行 = 配列の各要素、列 = 要素の直下のフィールド（要素が基本型なら「値」の1列）。
 * 入れ子の構造は「…」で省略する。件数が多くても軽いように、見えている行だけ描画する。
 */

import type { BinaryRange } from './BinaryRange';
import type { DisplayRadix } from './BinaryInterpretType';
import { attachTooltip } from './tooltip';

/** 1行の高さ（px）。style.css の .array-table td の高さと合わせる */
const ROW_HEIGHT = 26;
/** 表示範囲の外に余分に描画する行数 */
const OVERSCAN = 10;

export interface ArrayTableOptions {
    /** 値の表示基数（構造ビューの表示形式に合わせる） */
    radix: DisplayRadix;
    /** 行をダブルクリック / Enter したとき（その要素をツリーと Hex に表示する） */
    onJump: (element: BinaryRange) => void;
}

interface Column {
    name: string;
    /** 型の表示名（例: U4） */
    type: string;
    doc?: string;
}

interface TableState {
    array: BinaryRange;
    columns: Column[];
    /** 要素が基本型（フィールドを持たない）か */
    primitive: boolean;
    options: ArrayTableOptions;
    selected: number;
}

let modal: HTMLDivElement | null = null;
let state: TableState | null = null;

/** 要素の直下のフィールドから列を作る（要素ごとに if で有無が違う場合もあるので、出てきた順にまとめる） */
function buildColumns(array: BinaryRange): { columns: Column[]; primitive: boolean } {
    const primitive = array.subRanges.every(element => element.subRanges.length === 0);
    if (primitive) {
        const first = array.subRanges[0];
        return { primitive, columns: [{ name: '値', type: first?.binaryInterpretType?.toString() ?? '', doc: first?.doc }] };
    }
    const columns: Column[] = [];
    for (const element of array.subRanges) {
        for (const child of element.subRanges) {
            if (columns.some(column => column.name === child.name)) continue;
            const type = child.isArray ? `配列(${child.subRanges.length})` : child.subRanges.length > 0 ? '構造' : child.binaryInterpretType?.toString() ?? '';
            columns.push({ name: child.name, type, doc: child.doc });
        }
    }
    return { primitive, columns };
}

/** セルに出す文字列（入れ子の構造は「…」） */
function cellText(range: BinaryRange | undefined, radix: DisplayRadix): { text: string; nested: boolean } {
    if (!range) return { text: '', nested: false };
    if (range.subRanges.length > 0) return { text: '…', nested: true };
    if (!range.binaryInterpretType) return { text: '', nested: false };
    try {
        return { text: range.binaryInterpretType.interpret(range.data, { radix }), nested: false };
    } catch {
        return { text: '?', nested: false };
    }
}

function hex(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
}

function getModal(): HTMLDivElement {
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'modal-overlay array-table-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content array-table-content" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="array-table-title"></h3>
            <button type="button" class="modal-close array-table-close" aria-label="閉じる">&times;</button>
          </div>
          <div class="array-table-hint">クリックで選択、ダブルクリックまたは Enter でその要素をツリーと Hex に表示（↑↓ で移動、Esc で閉じる）</div>
          <div class="array-table-scroll" tabindex="0">
            <table class="array-table">
              <thead></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>`;
    document.body.append(modal);

    const scroll = modal.querySelector<HTMLDivElement>('.array-table-scroll')!;
    const tbody = modal.querySelector<HTMLTableSectionElement>('tbody')!;

    modal.querySelector('.array-table-close')!.addEventListener('click', closeArrayTable);
    // 背景（表の外側）のクリックで閉じる
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeArrayTable();
    });
    scroll.addEventListener('scroll', renderRows);
    tbody.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-index]');
        if (row) selectRow(Number(row.dataset.index));
    });
    tbody.addEventListener('dblclick', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-index]');
        if (row) jumpToRow(Number(row.dataset.index));
    });
    modal.addEventListener('keydown', (e) => {
        if (!state) return;
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeArrayTable();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(state.array.subRanges.length - 1, Math.max(0, state.selected + (e.key === 'ArrowDown' ? 1 : -1)));
            selectRow(next, true);
        } else if (e.key === 'Enter' && state.selected >= 0) {
            e.preventDefault();
            jumpToRow(state.selected);
        }
    });

    // 列見出しに乗せると、そのフィールドの説明を出す
    attachTooltip(modal.querySelector<HTMLElement>('thead')!, (target) => {
        const th = target.closest<HTMLTableCellElement>('th[data-column]');
        const column = th && state?.columns[Number(th.dataset.column)];
        if (!th || !column?.doc) return null;
        return { anchor: th, content: { title: column.name, body: column.doc } };
    });

    return modal;
}

function renderHeader(): void {
    if (!modal || !state) return;
    const headerRow = document.createElement('tr');
    const addHeader = (label: string, sub?: string, columnIndex?: number) => {
        const th = document.createElement('th');
        th.textContent = label;
        if (sub) {
            const small = document.createElement('small');
            small.textContent = sub;
            th.append(small);
        }
        if (columnIndex !== undefined) th.dataset.column = String(columnIndex);
        headerRow.append(th);
    };
    addHeader('#');
    state.columns.forEach((column, index) => addHeader(column.name, column.type, index));
    addHeader('オフセット');
    modal.querySelector('thead')!.replaceChildren(headerRow);
}

/** 見えている範囲の行だけ描画する（上下は空の行で高さを確保する） */
function renderRows(): void {
    if (!modal || !state) return;
    const scroll = modal.querySelector<HTMLDivElement>('.array-table-scroll')!;
    const tbody = modal.querySelector<HTMLTableSectionElement>('tbody')!;
    const total = state.array.subRanges.length;
    const columnCount = state.columns.length + 2;

    // 前回の表のスクロール位置が残っていても範囲外にならないよう、件数で上限をかける
    const first = Math.min(total, Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - OVERSCAN));
    const last = Math.min(total, Math.max(first, Math.ceil((scroll.scrollTop + scroll.clientHeight) / ROW_HEIGHT) + OVERSCAN));

    const spacer = (rows: number) => {
        const tr = document.createElement('tr');
        tr.className = 'array-table-spacer';
        const td = document.createElement('td');
        td.colSpan = columnCount;
        td.style.height = `${rows * ROW_HEIGHT}px`;
        tr.append(td);
        return tr;
    };

    const rows: HTMLTableRowElement[] = [];
    if (first > 0) rows.push(spacer(first));
    for (let index = first; index < last; index++) {
        const element = state.array.subRanges[index];
        const tr = document.createElement('tr');
        tr.dataset.index = String(index);
        if (index === state.selected) tr.classList.add('selected');

        const addCell = (text: string, className?: string, title?: string) => {
            const td = document.createElement('td');
            td.textContent = text;
            if (className) td.className = className;
            if (title) td.title = title;
            tr.append(td);
        };
        addCell(String(index), 'array-table-index');
        for (const column of state.columns) {
            const range = state.primitive ? element : element.subRanges.find(child => child.name === column.name);
            const { text, nested } = cellText(range, state.options.radix);
            addCell(text, nested ? 'array-table-nested' : undefined, nested ? '入れ子の項目（ダブルクリックしてツリーで確認）' : undefined);
        }
        addCell(hex(element.data.byteOffset), 'array-table-offset');
        rows.push(tr);
    }
    if (last < total) rows.push(spacer(total - last));
    tbody.replaceChildren(...rows);
}

/**
 * 行を選択する
 * 行を作り直すと、ダブルクリックの1回目と2回目が別の要素になってブラウザが dblclick を出さないため、
 * 選択は今ある行のクラスの付け替えだけで行う（行の作り直しはスクロールで表示範囲が変わったときだけ）
 */
function selectRow(index: number, scrollIntoView = false): void {
    if (!modal || !state || index < 0) return;
    state.selected = index;
    modal.querySelectorAll<HTMLTableRowElement>('tbody tr[data-index]').forEach(row => {
        row.classList.toggle('selected', Number(row.dataset.index) === index);
    });
    if (scrollIntoView) {
        const scroll = modal.querySelector<HTMLDivElement>('.array-table-scroll')!;
        const headerHeight = modal.querySelector('thead')!.getBoundingClientRect().height;
        const top = index * ROW_HEIGHT;
        if (top < scroll.scrollTop) {
            scroll.scrollTop = top;
        } else if (top + ROW_HEIGHT > scroll.scrollTop + scroll.clientHeight - headerHeight) {
            scroll.scrollTop = top + ROW_HEIGHT - scroll.clientHeight + headerHeight;
        }
        // スクロールしたときは scroll イベントで行が作り直される。選択した行がまだ描画範囲外なら、ここで描き直す
        if (!modal.querySelector(`tbody tr[data-index="${index}"]`)) renderRows();
    }
}

function jumpToRow(index: number): void {
    if (!state) return;
    const element = state.array.subRanges[index];
    const { onJump } = state.options;
    closeArrayTable();
    if (element) onJump(element);
}

/** 配列を表形式でモーダル表示する */
export function openArrayTable(array: BinaryRange, options: ArrayTableOptions): void {
    const dialog = getModal();
    const { columns, primitive } = buildColumns(array);
    state = { array, columns, primitive, options, selected: -1 };

    dialog.querySelector('.array-table-title')!.textContent = `${array.name}（${array.subRanges.length}件）`;
    renderHeader();
    const scroll = dialog.querySelector<HTMLDivElement>('.array-table-scroll')!;
    // 非表示（display: none）の要素ではスクロール位置を変えられないので、表示してから先頭に戻す
    dialog.style.display = 'flex';
    scroll.scrollTop = 0;
    renderRows();
    scroll.focus();
}

export function closeArrayTable(): void {
    if (modal) modal.style.display = 'none';
    state = null;
}
