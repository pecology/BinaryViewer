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
        let detailsElement = (e.target as HTMLElement).closest("[data-start-index]") as HTMLElement;

        const startIndex = parseInt(detailsElement.dataset.startIndex!);
        const endIndex = parseInt(detailsElement.dataset.endIndex!);
        console.log(`Start: ${startIndex}, End: ${endIndex}`);

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parsed, startIndex, endIndex - 1);
        highlightRangeList.shift(); // 最初の要素は全体なので削除
        
        highlightHexTable([...document.querySelectorAll<HTMLTableCellElement>('#hex-table td')], highlightRangeList);
        highlightDetails([...document.querySelectorAll<HTMLElement>('#hex-structure details')], highlightRangeList);
    });
    
    document.querySelector<HTMLElement>('#hex-table')!.addEventListener('click', (e) => {
        // テーブルをクリックしたときも同様に色付けする
        console.log(e.target);
        const td = e.target as HTMLTableCellElement;
        const index = parseInt(td.dataset.index!);

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parsed, index, index);
        highlightRangeList.shift(); // 最初の要素は全体なので削除

        // 色付け処理
        highlightHexTable([...document.querySelectorAll<HTMLTableCellElement>('#hex-table td')], highlightRangeList);
        highlightDetails([...document.querySelectorAll<HTMLElement>('#hex-structure details')], highlightRangeList);

        //TODO ファイルコンテンツのパースがうまくいってない
        // バイナリのデータが多いときのページング
        // 縦スクロール
        // Rangeからテーブルの要素へ　RangeからStructureの要素を探す関数があってもよいかも
        // その逆も
        // Range ⇒　それを含むRangeの階層を取得　⇒　階層毎にハイライト　みたいなのが見通しよさそう
    });
});

const getRangeContainsList = (range: BinaryRange, startIndex: number, endIndex: number): BinaryRange[] => {
    if (startIndex >= range.data.byteOffset && endIndex < range.data.byteOffset + range.data.byteLength) {
        const sub = range.subRanges.reduce((acc, child) => acc.concat(getRangeContainsList(child, startIndex, endIndex)), [] as BinaryRange[]);
        return [range, ...sub];
    }
    else {
        return [];
    }
}

const highlightHexTable = (tds: HTMLTableCellElement[], highlightRangeList: BinaryRange[] ) => {
    tds.forEach(td => {
        // 現在のハイライトを解除
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(i => td.classList.remove("highlighted" + i));

        // ハイライト対象のRangeに含まれるかどうかをチェック
        const index = parseInt(td.dataset.index!);
        const highlightCount = highlightRangeList.filter(
            range => range.data.byteOffset <= index &&
                        range.data.byteOffset + range.data.byteLength > index
        ).length;
        if (highlightCount > 0) {
            // 含むRangeが多いほど色を濃くする
            td.classList.add("highlighted" + highlightCount);
        }
    });
}

const highlightDetails = (details: HTMLElement[], highlightRangeList: BinaryRange[]) => {
        details.forEach(details => {
            // 現在のハイライトを解除
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(i => details.classList.remove("highlighted" + i));
        });

        highlightRangeList.forEach((range, index) => {
            const highlightDetails = details.filter(d => d.dataset.startIndex === range.data.byteOffset.toString() &&
                                                         d.dataset.endIndex === (range.data.byteOffset + range.data.byteLength).toString())

            if (highlightDetails.length > 0) {
                highlightDetails[0].classList.add("highlighted" + (index + 1));
            }
        });
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
                acc + `<tr><th>${byteToString(rowIndex)}</th>${r.reduce((acc2, b, colIndex) => acc2 + `<td data-index="${rowIndex * 16 + colIndex + offset}">${byteToString(b)}</td>`, "")}</tr>`, "")}
            </table>
        `;
}

const toStructureHtmlString = (segment: BinaryRange): string => {
    const startIndex = segment.data.byteOffset;
    const endIndex = startIndex + segment.data.byteLength;
    return `
<details open data-start-index="${startIndex}" data-end-index="${endIndex}">
  <summary><span class="cancel-toggle"> ${segment.name} (${byteToString(startIndex)} ～ ${byteToString(endIndex - 1)})</span></summary>
  <div>
    ${segment.subRanges.reduce((acc, child) => acc + toStructureHtmlString(child), "")}
  </div>
</details>
`;
}



setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
