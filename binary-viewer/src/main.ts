import './style.css'
import typescriptLogo from './typescript.svg'
import viteLogo from '/vite.svg'
import { setupCounter } from './counter.ts'
import { ZipParser } from './zipParser.ts'
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
    <input type="file" id="fileInput" />
    <button id="load-button">Load File</button>
  </div>
  <div id="output">
    <div id="hex-table" class="col">
      <a href="https://vite.dev" target="_blank">
        <img src="${viteLogo}" class="logo" alt="Vite logo" />
      </a>
      <a href="https://www.typescriptlang.org/" target="_blank">
        <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
      </a>
      <h1>Vite + TypeScript</h1>
      <div class="card">
        <button id="counter" type="button"></button>
      </div>
      <p class="read-the-docs">
        Click on the Vite and TypeScript logos to learn more
      </p>
    </div>
    <div id="hex-structure" class="col">
      <h2>Test</h2>
    </div>
  </div>
`

document.querySelector<HTMLButtonElement>('#load-button')!.addEventListener('click', async () => {
    const fileInput = document.querySelector<HTMLInputElement>('#fileInput')!;
    const data = await fileInput.files![0]?.arrayBuffer();
    const parsed = ZipParser.parse(new Uint8Array(data));
    console.log(parsed);
    const hexTableHtml = toHexTableHtmlString(parsed);

    document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = hexTableHtml;
    document.querySelector<HTMLDivElement>('#hex-structure')!.innerHTML = toStructureHtmlString(parsed);

    document.querySelector<HTMLElement>('#hex-structure > details')!.addEventListener('mouseover', (e) => {

    });

    document.querySelector<HTMLElement>('#hex-structure > details')!.addEventListener('click', (e) => {
        console.log(e.target);
        if ((e.target as HTMLElement).classList.contains("cancel-toggle")) {
            // detailsの開閉の動作をキャンセルしたい
            e.preventDefault();
        }

        // クリックしたRangeに対応するTableの方の色付けをしたい
        let detailsElement = (e.target as HTMLElement).closest("[data-offset]") as HTMLElement;

        const offset = parseInt(detailsElement.dataset.offset!);
        const length = parseInt(detailsElement.dataset.length!);

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parsed, offset, length);
        highlightRangeList.shift(); // 最初の要素は全体なので削除

        // 色付け処理
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td'),
        ...document.querySelectorAll<HTMLElement>('#hex-structure details')
        ].forEach(e => highlight(e, highlightRangeList));
    });

    document.querySelector<HTMLElement>('#hex-table')!.addEventListener('click', (e) => {
        // テーブルをクリックしたときも同様に色付けする
        const td = e.target as HTMLTableCellElement;
        const offset = parseInt(td.dataset.offset!);

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parsed, offset);
        highlightRangeList.shift(); // 最初の要素は全体なので削除

        // 色付け処理
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td'),
        ...document.querySelectorAll<HTMLElement>('#hex-structure details')
        ].forEach(e => highlight(e, highlightRangeList));

        //TODO ファイルコンテンツのパースがうまくいってない
        // バイナリのデータが多いときのページング
        // 縦スクロール

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

const byteToString = (byte: number) => byte.toString(16).padStart(2, '0').toUpperCase();
const toHexTableHtmlString = (hexRange: BinaryRange): string => {
    const offset = hexRange.data.byteOffset;
    return `
            <table class="table table-sm table-bordered">
                <thead>
                    <tr>
                        <th>Pos</th>
                        ${[...Array(16)].map((_, i) => i).reduce((acc, b) => acc + `<th>${byteToString(b)}</th>`, "")}
                    </tr>
                </thead>
                    ${chunk(hexRange.data, 16)
            .reduce((acc, r, rowIndex) =>
                acc + `<tr><th>${byteToString(rowIndex)}</th>${r.reduce((acc2, b, colIndex) => acc2 + `<td data-offset="${rowIndex * 16 + colIndex + offset}" data-highlight="0">${byteToString(b)}</td>`, "")}</tr>`, "")}
            </table>
        `;
}

const toStructureHtmlString = (segment: BinaryRange): string => {
    return `
<details open data-offset="${segment.data.byteOffset}" data-length="${segment.data.byteLength}" data-highlight="0">
  <summary><span class="cancel-toggle"> ${segment.name} (${rangeToString(segment)})</span></summary>
  <div>
    ${segment.subRanges.reduce((acc, child) => acc + toStructureHtmlString(child), "")}
  </div>
</details>
`;
}

const rangeToString = (range: BinaryRange): string => {
    if (range.data.byteLength === 0) {
        return "-"
    }

    const startIndex = range.data.byteOffset;
    const endIndex = startIndex + range.data.byteLength;
    return `${range.name} (${byteToString(startIndex)} ～ ${byteToString(endIndex - 1)})`;
}



setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
