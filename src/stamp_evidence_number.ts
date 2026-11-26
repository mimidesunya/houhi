/**
 * 証拠番号スタンプツール
 * PDF／画像ファイル名から証拠番号・資料番号（例: 甲1_契約書.pdf、乙A1_写真.pdf、資料1_ウェブサイト.pdf、参考資料1_通知書.pdf）を抽出し、各ページの右上に赤文字でスタンプする。
 * 出力先: 入力ディレクトリ内の stamped/ フォルダ
 *
 * 入力:
 * - PDF または画像ファイル（JPG, PNG）を 1 件以上指定できます。
 * - 画像ファイルは自動的にA4サイズのPDFに変換してから処理します。
 * - ファイル名先頭の `甲1_契約書.pdf`, `乙2_メール.pdf`, `甲3-1_領収書.pdf`, `乙A1の2_写真.pdf` などから証拠番号を抽出します。
 * - 苦情申出の意見書などに付ける資料は `資料1_〇〇.pdf`, `資料2-1_〇〇.pdf` の形式に対応します。
 *   資料には「号証」を付けず、`資料1` とだけスタンプします。
 * - 行政不服審査の審査会（情報公開・個人情報保護審査会など）へ意見書と出す参考資料は
 *   `参考資料1_〇〇.pdf`, `参考資料2-1_〇〇.pdf` の形式に対応します。資料と同じく「号証」を付けず、`参考資料1` とスタンプします。
 *
 * 出力:
 * - 最初の入力ファイルの親フォルダに `stamped/` を作成し、その中へ個別PDFを出力します。
 * - 成功ファイルが 2 件以上ある場合は `_結合_号証一式.pdf`（資料のみなら `_結合_資料一式.pdf`、参考資料のみなら
 *   `_結合_参考資料一式.pdf`、種別が混ざれば `_結合_一式.pdf`）も作成します。名前は `--combined-name` で変えられます。
 *
 * オプション:
 * - `--all-pages`: 全ページにスタンプします（既定は1ページ目のみ）。
 * - `--font-size N`: A4印刷換算のフォントサイズを指定します。
 * - `--mints`: 民事裁判書類電子提出システム（mints）向け。表記を「甲001」「甲002-1」の形式（「号証」なし、主番号3桁）にし、
 *   出力先を `mints/`、ファイル名の先頭を同じ形式に改め、結合PDFは作らない（mints は1証拠1ファイル、A4/A3のみ）。黒帯も付けない。
 * - `--no-tab`: 境目の黒帯を付けない。
 * - `--tab-steps N`: 黒帯を上下にずらす段数（既定は4）。
 * - `--combined-name 名前`: 結合PDFのファイル名（`stamped/` の中）。`.pdf` がなければ付けます。
 *   例: `--combined-name "令和○年（行情）諮問第○号_参考資料.pdf"`。
 *
 * 境目の黒帯:
 * - 番号の右から用紙の右端まで、黒の斜めの縞の帯を付けます。まとめて印刷して重ねたとき、右端を見れば号証の境目が分かります。
 *   縞にしてあるのは、スキャンの黒い縁や墨消しと見分けやすくするためです。
 * - 番号と帯は、号証番号の順に帯の高さ1つ分ずつ下へずらし、4段（`--tab-steps`）で上に戻ります。隣り合う号証は必ず別の高さになります。
 * - 段は、そのとき一緒に処理した号証の中での順番で決まります。一部の号証だけを処理し直すと段が変わるので、全部をまとめて処理し直してください。
 * - 用紙の右端の数mmは、プリンタの印刷できない余白で白く残ります。
 * - 横長の頁は、頁の上が左（綴じ側）に来るよう回して縦の頁にします（文書の全頁をそろえる）。番号と帯は縦長の頁と同じ場所に刷られます。
 *   画面では横長の頁が横倒しに見えます。`--no-tab` のときは回しません。
 * - 元の頁の回転（/Rotate）は保ち、番号は表示したときの右上に正立で刷ります。
 *
 * 補足:
 * - ファイルは証拠番号順に自然ソートして処理します。
 * - 証拠番号を抽出できないファイルは SKIP します。
 * - 複数PDF結合時は、両面印刷向けに必要な空白ページを補います。
 *
 * 使い方:
 *   node src/stamp_evidence_number.js <PDF/画像ファイルパス...>
 *
 * オプション:
 *   --all-pages   全ページにスタンプ（デフォルトは1ページ目のみ）
 *   --font-size N A4印刷換算のフォントサイズ指定（デフォルト: 20）
 *   --no-blank-pages 結合時に空白ページを挿入しない（FAX向け）
 *   --mints       mints 提出用（「甲001」形式・mints/ へ出力・結合なし・黒帯なし）
 *   --no-tab      境目の黒帯を付けない
 *   --tab-steps N 黒帯を上下にずらす段数（デフォルト: 4）
 *   --combined-name 名前 結合PDFのファイル名
 *
 * 審査会へ出す参考資料の例（「参考資料1」などと黒帯を刷り、`stamped/_結合_参考資料一式.pdf` にまとめる）:
 *   node dist/src/stamp_evidence_number.js --no-blank-pages 参考資料1_〇〇.pdf 参考資料2_〇〇.pdf 参考資料3_〇〇.pdf
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const core = require('./lib/stamp_core');
const {
    DEFAULT_FONT_SIZE,
    DEFAULT_TAB_STEPS,
    extractEvidenceNumber,
    getMaterialKind,
    isShiryo,
    buildStampText,
    toMintsNumber,
    naturalSortKey,
    compareSortKeys,
    normalizeCombinedName,
    buildCombinedName,
    getA4PrintScaleForPage,
    getStampMetricsForA4Print,
    getStampLayout,
    getTabStripes,
    getPageRotation,
    getDisplaySize,
    toPageSpace,
    turnLandscapePagesToPortrait,
    ensureA4Pages,
    isImageFileName,
    convertImageBytesToPdf,
    stampPdfBytes,
    makeFontPainter,
    mergeStampedPdfBytes,
} = core;

// 日本語フォント候補（TTFを優先、TTC は pdf-lib で扱えないため避ける）
const FONT_CANDIDATES = [
    'C:\\Windows\\Fonts\\yumin.ttf',      // 游明朝 Regular (Windows, TTF)
    'C:\\Windows\\Fonts\\yumindb.ttf',    // 游明朝 Demibold (Windows, TTF)
    'C:\\Windows\\Fonts\\HGRSMP.TTF',     // HGR創英角ｺﾞｼｯｸ (Windows, TTF)
    'C:\\Windows\\Fonts\\NotoSansJP-VF.ttf', // Noto Sans JP Variable (Windows, TTF)
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', // macOS
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', // Linux
];

/**
 * 利用可能な日本語フォントを探す
 */
function findJapaneseFont() {
    for (const fontPath of FONT_CANDIDATES) {
        if (fs.existsSync(fontPath)) {
            return fontPath;
        }
    }
    return null;
}

/**
 * 画像ファイルかどうか判定
 */
function isImageFile(filePath) {
    return isImageFileName(filePath);
}

/**
 * 画像ファイルをA4サイズのPDFに変換する
 * 画像はアスペクト比を維持しつつA4に収まるようにリサイズし中央配置する
 */
async function convertImageToPdf(imagePath) {
    return convertImageBytesToPdf(fs.readFileSync(imagePath), path.extname(imagePath).toLowerCase() === '.png');
}

/**
 * 個別に出力するPDFのファイル名。拡張子を .pdf にし、mints ではファイル名の先頭の号証を mints 表記に置き換える。
 */
function buildOutputFilename(filename, evidenceNumber, mints = false) {
    return core.buildOutputFilename(path.basename(filename), evidenceNumber, mints);
}

/**
 * PDFに証拠番号スタンプを追加し、スタンプ済みPDFのバイト列を返す（outputPath にも書き出す）
 */
type StampOptions = {
    allPages?: boolean;
    fontSize?: number;
    mints?: boolean;
    tab?: boolean;
    tabIndex?: number;
    tabSteps?: number;
};

async function stampPdf(inputPath, outputPath, evidenceNumber, font, options: StampOptions = {}) {
    const { bytes } = await stampPdfBytes(
        fs.readFileSync(inputPath),
        evidenceNumber,
        (pdfDoc, stampText) => makeFontPainter(pdfDoc, stampText, font, fontkit),
        options,
    );
    fs.writeFileSync(outputPath, bytes);
    return bytes;
}

/**
 * 複数のスタンプ済みPDFを結合（両面印刷対応：奇数ページの文書の後に空白ページ挿入）
 */
async function mergeStampedPdfs(stampedPdfBytesList, outputPath, { insertBlankPages = true } = {}) {
    const { bytes, totalPages, blankPages } = await mergeStampedPdfBytes(stampedPdfBytesList.map(item => item.bytes), { insertBlankPages });
    fs.writeFileSync(outputPath, bytes);
    return { totalPages, blankPages };
}

/**
 * メイン処理
 */
async function main() {
    const args = process.argv.slice(2);

    // オプション解析
    const allPages = args.includes('--all-pages');
    const noBlankPages = args.includes('--no-blank-pages');
    const mints = args.includes('--mints');
    const tab = !mints && !args.includes('--no-tab');
    let fontSize = DEFAULT_FONT_SIZE;
    const fontSizeIdx = args.indexOf('--font-size');
    if (fontSizeIdx !== -1 && args[fontSizeIdx + 1]) {
        fontSize = parseInt(args[fontSizeIdx + 1], 10);
    }
    let tabSteps = DEFAULT_TAB_STEPS;
    const tabStepsIdx = args.indexOf('--tab-steps');
    if (tabStepsIdx !== -1 && args[tabStepsIdx + 1]) {
        tabSteps = Math.max(1, parseInt(args[tabStepsIdx + 1], 10) || DEFAULT_TAB_STEPS);
    }
    let combinedName = null;
    const combinedNameIdx = args.indexOf('--combined-name');
    try {
        combinedName = normalizeCombinedName(combinedNameIdx !== -1 ? args[combinedNameIdx + 1] : '');
    } catch (err) {
        console.error(`エラー: ${err.message}`);
        process.exit(1);
    }

    // ファイルパスのみ抽出（値を取るオプションの次の引数は除く）
    const valueOptions = ['--font-size', '--tab-steps', '--combined-name'];
    const filePaths = args.filter((a, i) => !a.startsWith('--') && !valueOptions.includes(args[i - 1]));

    if (filePaths.length === 0) {
        console.error('使い方: node stamp_evidence_number.js <PDF/画像ファイル...>');
        process.exit(1);
    }

    // 結合PDFの名前が個別のPDFの名前と同じだと、個別のPDFを上書きしてしまう
    if (combinedName && !mints) {
        const clash = filePaths.find(filePath => {
            const evidenceNum = extractEvidenceNumber(path.basename(filePath));
            return evidenceNum && buildOutputFilename(path.basename(filePath), evidenceNum).toLowerCase() === combinedName.toLowerCase();
        });
        if (clash) {
            console.error(`エラー: --combined-name の「${combinedName}」が、個別に出力するPDFの名前と同じです（${path.basename(clash)}）。`);
            process.exit(1);
        }
    }

    // フォント準備
    console.log('フォントを探しています...');
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        console.error('エラー: 日本語フォントが見つかりません。');
        console.error('確認: ' + FONT_CANDIDATES.join(', '));
        process.exit(1);
    }
    console.log(`フォント: ${path.basename(fontPath)}`);

    const fontBytes = fs.readFileSync(fontPath);

    // 出力ディレクトリ（最初のファイルの親ディレクトリ基準）
    const firstDir = path.dirname(filePaths[0]);
    const outputDir = path.join(firstDir, mints ? 'mints' : 'stamped');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // ソート
    // 甲*.pdf に限定せず、乙・丙等も対象
    const sortedPaths = [...filePaths].sort((a, b) => compareSortKeys(naturalSortKey(a), naturalSortKey(b)));

    const stampMode = allPages ? '全ページ' : '1ページ目のみ';
    const blankMode = mints ? 'mints提出用（結合なし）' : (noBlankPages ? '空白ページなし' : '両面印刷対応');
    const tabMode = tab ? `境目の黒帯 ${tabSteps}段` : '黒帯なし';
    console.log(`対象: ${sortedPaths.length} ファイル`);
    console.log(`出力: ${outputDir}`);
    console.log(`モード: ${stampMode} / フォントサイズ: ${fontSize}pt / ${blankMode} / ${tabMode}`);
    if (combinedName) {
        console.log(mints ? '注意: --mints では結合PDFを作らないので、--combined-name は使いません。' : `結合PDFの名前: ${combinedName}`);
    }

    // 黒帯の段は、番号のあるファイルの中での順番で決める（隣り合う号証は必ず別の段になる）
    const tabIndexOf = new Map<string, number>();
    sortedPaths
        .filter(filePath => extractEvidenceNumber(path.basename(filePath)))
        .forEach((filePath, index) => tabIndexOf.set(filePath, index));
    console.log('─'.repeat(50));

    let okCount = 0;
    let errCount = 0;
    const stampedList = []; // 結合用にスタンプ済みPDFバイト列を保持

    // 並列処理に変更
    const tasks = sortedPaths.map(async (filePath) => {
        const filename = path.basename(filePath);
        const evidenceNum = extractEvidenceNumber(filename);

        if (!evidenceNum) {
            console.log(`  SKIP  ${filename} （証拠番号なし）`);
            return null;
        }

        // 画像ファイルの場合、PDFに変換してから処理
        let inputForStamp = filePath;
        let tempPdfPath: string | null = null;
        if (isImageFile(filePath)) {
            console.log(`  変換  ${filename} → PDF`);
            try {
                const pdfBytes = await convertImageToPdf(filePath);
                tempPdfPath = path.join(outputDir, path.basename(filename, path.extname(filename)) + '.pdf');
                fs.writeFileSync(tempPdfPath, pdfBytes);
                inputForStamp = tempPdfPath;
            } catch (err) {
                console.error(`  変換エラー ${filename}: ${err.message}`);
                return { success: false };
            }
        }

        const outputFilename = buildOutputFilename(filename, evidenceNum, mints);
        const outputPath = path.join(outputDir, outputFilename);
        try {
            const pdfBytes = await stampPdf(inputForStamp, outputPath, evidenceNum, fontBytes, {
                allPages, fontSize, mints, tab, tabIndex: tabIndexOf.get(filePath) ?? 0, tabSteps,
            });
            // 画像→PDF変換の中間ファイルが出力先と異なる場合は削除
            if (tempPdfPath && tempPdfPath !== outputPath) {
                try { fs.unlinkSync(tempPdfPath); } catch (_) {}
            }
            console.log(`  完了  ${buildStampText(evidenceNum, mints)} ← ${filename}`);
            return { success: true, bytes: pdfBytes, evidenceNum };
        } catch (err) {
            console.error(`  エラー ${filename}: ${err.message}`);
            return { success: false };
        }
    });

    // 全ての処理が終わるのを待つ
    const results = await Promise.all(tasks);

    // 結果を集計（Promise.allは順序を保持するのでソート順は維持される）
    for (const res of results) {
        if (!res) continue; // SKIP
        if (res.success) {
            stampedList.push({ bytes: res.bytes, evidenceNum: res.evidenceNum });
            okCount++;
        } else {
            errCount++;
        }
    }

    console.log('─'.repeat(50));
    console.log(`処理完了: ${okCount} 成功 / ${errCount} エラー`);

    // 結合PDF生成（2ファイル以上の場合）
    if (!mints && combinedName && stampedList.length < 2) {
        console.log(`注意: 結合PDFは2件以上のときだけ作るので、「${combinedName}」は作りませんでした。`);
    }
    if (!mints && stampedList.length >= 2) {
        console.log('─'.repeat(50));
        const mergeMode = noBlankPages ? '結合PDF作成中（空白ページなし）...' : '結合PDF作成中（両面印刷対応）...';
        console.log(mergeMode);
        try {
            const mergedName = buildCombinedName(stampedList.map(item => item.evidenceNum), combinedName);
            const mergedPath = path.join(outputDir, mergedName);
            const { totalPages, blankPages } = await mergeStampedPdfs(stampedList, mergedPath, { insertBlankPages: !noBlankPages });
            console.log(`  完了  ${stampedList.length} 文書 → ${totalPages} ページ（空白ページ: ${blankPages}）`);
            console.log(`  出力: ${mergedPath}`);
        } catch (err) {
            console.error(`  結合エラー: ${err.message}`);
        }
    }

    if (okCount > 0) {
        console.log(`\n出力先: ${outputDir}`);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`致命的エラー: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    extractEvidenceNumber,
    toMintsNumber,
    getMaterialKind,
    isShiryo,
    buildStampText,
    naturalSortKey,
    buildOutputFilename,
    normalizeCombinedName,
    buildCombinedName,
    isImageFile,
    findJapaneseFont,
    getA4PrintScaleForPage,
    getStampMetricsForA4Print,
    getStampLayout,
    getTabStripes,
    getPageRotation,
    getDisplaySize,
    toPageSpace,
    turnLandscapePagesToPortrait,
    ensureA4Pages,
    stampPdf,
    mergeStampedPdfs,
};
