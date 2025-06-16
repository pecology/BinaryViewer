import './style.css'
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
    <div>
        <input type="file" id="fileInput" />
        <button id="load-button">Load File</button>
    </div>
  </div>
`;

document.querySelector<HTMLButtonElement>('#load-button')!.addEventListener('click', async () => {
    const fileInput = document.querySelector<HTMLInputElement>('#fileInput')!;
    const data = await fileInput.files![0]?.arrayBuffer();
    const parseResult = ZipParser.parse(new Uint8Array(data));
    
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

    document.querySelector<HTMLDivElement>('#hex-structure')!.innerHTML = toStructureHtmlString(parseResult);

    document.querySelector<HTMLElement>('#hex-structure > details')!.addEventListener('mouseover', (e) => {

    });

    document.querySelector<HTMLElement>('#paging-index-input')!.addEventListener('input', (e) => {
        const pagingIndex = parseInt((e.target as HTMLInputElement).value);
        if (isNaN(pagingIndex))
        {
            return;
        }

        document.querySelector<HTMLDivElement>('#hex-table')!.innerHTML = toHexTableHtmlString(parseResult, pagingIndex);

        document.querySelector<HTMLDivElement>('#display-range-text')!.innerHTML = `(${pagingIndex * 1024} ~ ${(pagingIndex + 1) * 1024 -1}byte)`
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
        ...document.querySelectorAll<HTMLElement>('#hex-structure details')
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
        const td = e.target as HTMLTableCellElement;
        const offset = parseInt(td.dataset.offset!);

        // ハイライト対象のRangeを取得
        const highlightRangeList: BinaryRange[] = getRangeContainsList(parseResult, offset);
        highlightRangeList.shift(); // 最初の要素は全体なので削除

        // 色付け処理
        [...document.querySelectorAll<HTMLTableCellElement>('#hex-table td'),
        ...document.querySelectorAll<HTMLElement>('#hex-structure details')
        ].forEach(e => highlight(e, highlightRangeList));

        // クリックした構造に対応する箇所に、テーブルのスクロールを合わせる
        [...document.querySelectorAll<HTMLElement>('#hex-structure details')]
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

const byteToString = (byte: number) => byte.toString(16).padStart(2, '0').toUpperCase();
const toHexTableHtmlString = (hexRange: BinaryRange, pageIndex: number = 0): string => {
    const displayArray = hexRange.data.subarray(pageIndex * 1024, (pageIndex + 1) * 1024);
    const offset = hexRange.data.byteOffset + (pageIndex * 1024);
    return `
            <table class="table table-sm table-bordered">
                <thead>
                    <tr>
                        <th>Pos</th>
                        ${[...Array(16)].map((_, i) => i).reduce((acc, b) => acc + `<th>${byteToString(b)}</th>`, "")}
                    </tr>
                </thead>
                    ${
                        chunk(displayArray, 16)
                            .reduce((acc, r, rowIndex) =>
                                acc + `<tr>
                                            <th>
                                                ${byteToString(rowIndex + (pageIndex * 1024 / 16))}
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
        `;
}

const toStructureHtmlString = (segment: BinaryRange): string => {
    return `
<details open data-offset="${segment.data.byteOffset}" data-length="${segment.data.byteLength}" data-highlight="0">
  <summary><span class="cancel-toggle"> ${segment.name} (${rangeToString(segment)})</span></summary>
  <div>
    ${segment.subRanges.reduce((acc, child) => acc + toStructureHtmlString(child), "")}
    ${segment.interpret()}
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
    return `${byteToString(startIndex)} ～ ${byteToString(endIndex - 1)}`;
}