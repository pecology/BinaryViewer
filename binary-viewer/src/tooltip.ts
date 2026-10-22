/**
 * 独自ツールチップ
 *
 * ブラウザ標準の title 属性は表示までの時間を変えられず、子要素にも効いてしまうため、
 * 構造ツリーや Hex テーブルの説明は自前の吹き出しで表示する。
 */

/** マウスを乗せてから表示するまでの時間（ms） */
const SHOW_DELAY_MS = 150;
/** マウス位置からのずらし幅（px） */
const OFFSET_X = 12;
const OFFSET_Y = 16;

export interface TooltipContent {
    /** 1行目に太字で出す見出し */
    title: string;
    /** 見出しの下に出す本文（改行可） */
    body?: string;
}

/**
 * ツールチップの内容を決める関数
 * @param target マウスが乗っている要素
 * @returns 表示する内容と、その内容の対象要素（同じ対象の間は出し直さない）。表示しない場合は null
 */
export type TooltipResolver = (target: HTMLElement) => { anchor: HTMLElement; content: TooltipContent } | null;

let tooltipElement: HTMLDivElement | null = null;
let currentAnchor: HTMLElement | null = null;
let showTimer: number | null = null;
let lastPointer = { x: 0, y: 0 };

function getTooltipElement(): HTMLDivElement {
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'app-tooltip';
        tooltipElement.setAttribute('role', 'tooltip');
        tooltipElement.hidden = true;
        document.body.append(tooltipElement);
    }
    return tooltipElement;
}

function hideTooltip(): void {
    if (showTimer !== null) {
        clearTimeout(showTimer);
        showTimer = null;
    }
    currentAnchor = null;
    if (tooltipElement) tooltipElement.hidden = true;
}

/** マウス位置の右下に出し、画面からはみ出す場合は反対側に寄せる */
function positionTooltip(): void {
    const tooltip = getTooltipElement();
    const { width, height } = tooltip.getBoundingClientRect();
    let left = lastPointer.x + OFFSET_X;
    let top = lastPointer.y + OFFSET_Y;
    if (left + width > window.innerWidth - 4) left = Math.max(4, lastPointer.x - OFFSET_X - width);
    if (top + height > window.innerHeight - 4) top = Math.max(4, lastPointer.y - OFFSET_Y - height);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function showTooltip(content: TooltipContent): void {
    const tooltip = getTooltipElement();
    const title = document.createElement('div');
    title.className = 'app-tooltip-title';
    title.textContent = content.title;
    const children: HTMLElement[] = [title];
    if (content.body) {
        const body = document.createElement('div');
        body.className = 'app-tooltip-body';
        body.textContent = content.body;
        children.push(body);
    }
    tooltip.replaceChildren(...children);
    tooltip.hidden = false;
    positionTooltip();
}

/**
 * container 内の要素にツールチップを付ける（イベントは container にまとめて登録する）
 */
export function attachTooltip(container: HTMLElement, resolve: TooltipResolver): void {
    container.addEventListener('mousemove', (e) => {
        lastPointer = { x: e.clientX, y: e.clientY };
        const resolved = e.target instanceof HTMLElement ? resolve(e.target) : null;
        if (!resolved) {
            hideTooltip();
            return;
        }
        if (resolved.anchor === currentAnchor) {
            // 同じ対象の上で動いている間は、表示中ならマウスに追従させる
            if (tooltipElement && !tooltipElement.hidden) positionTooltip();
            return;
        }
        hideTooltip();
        currentAnchor = resolved.anchor;
        showTimer = window.setTimeout(() => {
            showTimer = null;
            showTooltip(resolved.content);
        }, SHOW_DELAY_MS);
    });
    container.addEventListener('mouseleave', hideTooltip);
    container.addEventListener('mousedown', hideTooltip);
}

// スクロールや Esc では、どこで起きても閉じる
window.addEventListener('scroll', hideTooltip, true);
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTooltip();
});
