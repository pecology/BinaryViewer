/**
 * 列幅のドラッグ変更
 *
 * レイアウト（CSS Grid）直下の各パネルの右端につまみを置き、
 * ドラッグで列幅を変更できるようにする。
 * 最後の列は常に残りの幅を使い、幅を変更していない列は CSS の既定幅のまま。
 * 変更した幅は localStorage に保存する。
 */

const STORAGE_KEY = 'layout:column-widths';
/** 列の最小幅（px） */
const MIN_COLUMN_WIDTH = 120;

/** 幅を変更していない列の既定値（style.css の grid-template-columns と合わせる） */
const defaultColumnSizes: Record<string, string> = {
    input: '280px',
    'dump-log': 'minmax(210px, 0.75fr)',
    hex: 'minmax(0, 1fr)',
    structure: 'minmax(0, 1fr)',
};

let columnWidths: Record<string, number> = loadColumnWidths();
let layoutElement: HTMLElement | null = null;
let isResizeDisabled: () => boolean = () => false;
// つまみとその左側のパネル（入力パネルはスクロールするので、つまみはパネルではなくレイアウト直下に置く）
const resizers: { handle: HTMLElement; panel: HTMLElement }[] = [];

function loadColumnWidths(): Record<string, number> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (parsed && typeof parsed === 'object') {
            return Object.fromEntries(
                Object.entries(parsed).filter(([, value]) => typeof value === 'number' && value > 0),
            );
        }
    } catch {
        // 保存値が壊れている・localStorage が使えない場合は既定幅で表示する
    }
    return {};
}

function saveColumnWidths(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
        // 保存できなくても、このページを開いている間の幅変更は有効
    }
}

function getVisiblePanels(): HTMLElement[] {
    if (!layoutElement) return [];
    return [...layoutElement.querySelectorAll<HTMLElement>(':scope > [data-column]')]
        .filter(panel => !panel.hidden);
}

/**
 * 表示中の列と保存済みの幅から grid-template-columns を組み立てて適用する
 * （ダンプログ表示の切り替えなどで列数が変わったときにも呼ぶ）
 */
export function applyColumnLayout(): void {
    if (!layoutElement) return;

    if (isResizeDisabled()) {
        // 狭い画面用のレイアウト（style.css のメディアクエリ）に任せる
        layoutElement.style.gridTemplateColumns = '';
        layoutElement.classList.remove('columns-resizable');
        return;
    }

    const panels = getVisiblePanels();
    layoutElement.style.gridTemplateColumns = panels
        .map((panel, index) => {
            const column = panel.dataset.column!;
            if (index === panels.length - 1) return 'minmax(0, 1fr)';
            const width = columnWidths[column];
            return width !== undefined ? `${width}px` : defaultColumnSizes[column] ?? 'minmax(0, 1fr)';
        })
        .join(' ');
    layoutElement.classList.add('columns-resizable');

    // 各つまみを、表示中のパネルの右端に合わせる（最後の列にはつまみを出さない）
    const lastPanel = panels[panels.length - 1];
    for (const { handle, panel } of resizers) {
        const visible = !panel.hidden && panel !== lastPanel;
        handle.hidden = !visible;
        if (visible) {
            handle.style.left = `${panel.offsetLeft + panel.offsetWidth - handle.offsetWidth / 2}px`;
        }
    }
}

function startResize(event: PointerEvent, panel: HTMLElement, handle: HTMLElement): void {
    const panels = getVisiblePanels();
    const index = panels.indexOf(panel);
    if (index < 0 || index === panels.length - 1) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    // 右側の列がそれぞれ最小幅を保てる範囲までしか広げない
    const rightPanels = panels.slice(index + 1);
    const rightWidth = rightPanels.reduce((sum, p) => sum + p.getBoundingClientRect().width, 0);
    const maxWidth = startWidth + rightWidth - MIN_COLUMN_WIDTH * rightPanels.length;
    const column = panel.dataset.column!;

    handle.setPointerCapture(event.pointerId);
    handle.classList.add('active');
    document.body.classList.add('column-resizing');

    const onMove = (moveEvent: PointerEvent) => {
        const width = Math.round(Math.min(maxWidth, Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX)));
        columnWidths[column] = width;
        applyColumnLayout();
    };
    const onEnd = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        handle.classList.remove('active');
        document.body.classList.remove('column-resizing');
        saveColumnWidths();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
}

/**
 * 列幅のドラッグ変更を有効にする
 * @param layout `data-column` 属性を持つパネルを直下に並べた Grid 要素
 * @param disabled true を返す間はドラッグ変更を無効にし、CSS のレイアウトに任せる
 */
export function setupColumnResizers(layout: HTMLElement, disabled: () => boolean): void {
    layoutElement = layout;
    isResizeDisabled = disabled;

    // 最後の列は残りの幅を使うので、つまみはそれ以外の列にだけ付ける
    const panels = [...layout.querySelectorAll<HTMLElement>(':scope > [data-column]')];
    panels.slice(0, -1).forEach(panel => {
        const handle = document.createElement('div');
        handle.className = 'column-resizer';
        handle.title = 'ドラッグで列幅を変更（ダブルクリックで元に戻す）';
        handle.addEventListener('pointerdown', event => startResize(event, panel, handle));
        handle.addEventListener('dblclick', () => {
            delete columnWidths[panel.dataset.column!];
            saveColumnWidths();
            applyColumnLayout();
        });
        layout.append(handle);
        resizers.push({ handle, panel });
    });

    window.addEventListener('resize', applyColumnLayout);
    applyColumnLayout();
}
