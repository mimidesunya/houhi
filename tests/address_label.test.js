const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    DEFAULT_PDF_ENGINE,
    RETIRED_LABEL_LAYOUT_NOTICE,
    SENDER_VCARD_FILE_NAME,
    buildLabelHtml,
    buildLabelsHtml,
    cleanPostalCode,
    formatAddressLines,
    labelPdfOptions,
    parseArgs,
    parseVCard
} = require('../dist/src/address_label.js');

const ADDRESS_LABEL_SCRIPT = path.resolve(__dirname, '../dist/src/address_label.js');
const PDF_CONVERTER_MODULE = path.resolve(__dirname, '../dist/src/lib/pdf_converter.js');

/**
 * 宛名ラベルのコマンドを、PDF 変換を差し替えて動かす（Copper・Chrome には送らない）。
 * 変換に渡った HTML・出力先・オプションと、標準出力・標準エラーを返す。PDF は作らないので開かれない
 */
function runAddressLabelCli(args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-address-label-'));
    try {
        fs.writeFileSync(path.join(dir, '宛先.vcf'), [
            'BEGIN:VCARD', 'FN:見本地方裁判所 第1民事部', 'TEL:03-0000-0000',
            'ADR:;;見本町1-2-3;見本市;見本県;123-4567;', 'END:VCARD'
        ].join('\n'), 'utf-8');
        fs.writeFileSync(path.join(dir, SENDER_VCARD_FILE_NAME), [
            'BEGIN:VCARD', 'FN:見本 太郎', 'TEL:090-0000-0000',
            'ADR:;;千代田1丁目1番1号;千代田区;東京都;100-0001;', 'END:VCARD'
        ].join('\n'), 'utf-8');
        const capturePath = path.join(dir, 'capture.json');
        const stubPath = path.join(dir, 'stub_pdf_converter.js');
        fs.writeFileSync(stubPath, [
            "const fs = require('fs');",
            `const converter = require(${JSON.stringify(PDF_CONVERTER_MODULE)});`,
            'converter.convertHtmlToPdf = async (htmlPath, outputPath, resourceDir, templateDir, options) => {',
            `    fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ html: fs.readFileSync(htmlPath, 'utf-8'), outputPath, options }));`,
            '};'
        ].join('\n'), 'utf-8');

        const result = spawnSync(process.execPath, ['--require', stubPath, ADDRESS_LABEL_SCRIPT, ...args, path.join(dir, '宛先.vcf')], {
            encoding: 'utf-8'
        });
        const captured = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, 'utf-8')) : null;
        return { status: result.status, stdout: result.stdout, stderr: result.stderr, captured };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('address_label: parses Japanese vCard contact data', () => {
    const contact = parseVCard([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:さいたま地方裁判所 第2民事部 合議B係',
        'TEL:048-863-9612',
        'ADR;TYPE=WORK:;;高砂 3-16-45;さいたま市 浦和区;埼玉県;3300063;日本',
        'END:VCARD'
    ].join('\n'));

    assert.equal(contact.name, 'さいたま地方裁判所 第2民事部 合議B係');
    assert.equal(cleanPostalCode(contact.address.postalCode), '330-0063');
    assert.deepEqual(formatAddressLines(contact), ['埼玉県 さいたま市 浦和区 高砂 3-16-45']);
    assert.equal(contact.phone, '048-863-9612');
});

test('address_label: uses fixed sender vCard filename', () => {
    assert.equal(SENDER_VCARD_FILE_NAME, '差出人.vcf');
});

test('address_label: removes duplicate postal code from LABEL address lines', () => {
    const contact = parseVCard([
        'BEGIN:VCARD',
        'FN:最高裁判所 秘書課文書開示第二係',
        'ADR:;;隼町4番2号;千代田区;東京都;102-8651;',
        'LABEL:〒1028651\\n東京都千代田区隼町4番2号\\n最高裁判所',
        'END:VCARD'
    ].join('\n'));

    assert.deepEqual(formatAddressLines(contact), [
        '東京都千代田区隼町4番2号',
        '最高裁判所'
    ]);
});

test('address_label: removes duplicate name from LABEL address lines', () => {
    const contact = parseVCard([
        'BEGIN:VCARD',
        'FN:法務省大臣官房会計課調達係',
        'ADR:;;霞が関1-1-1;千代田区;東京都;100-8977;',
        'LABEL:〒100-8977\\n東京都千代田区霞が関1-1-1\\n法務省大臣官房会計課調達係 御中',
        'END:VCARD'
    ].join('\n'));

    assert.deepEqual(formatAddressLines(contact), [
        '東京都千代田区霞が関1-1-1'
    ]);
});

test('address_label: removes duplicate sender name from LABEL address lines', () => {
    const contact = parseVCard([
        'BEGIN:VCARD',
        'FN:宮部 龍彦',
        'ADR:;;大師駅前1-3-11 第2松坂荘101号;川崎市川崎区;神奈川県;210-0802;',
        'LABEL:〒210-0802\\n神奈川県川崎市川崎区\\n大師駅前1-3-11 第2松坂荘101号\\n宮部 龍彦',
        'END:VCARD'
    ].join('\n'));

    assert.deepEqual(formatAddressLines(contact), [
        '神奈川県川崎市川崎区',
        '大師駅前1-3-11 第2松坂荘101号'
    ]);
});

test('address_label: --label-layout=letterpack は以前どおり受け付ける（付けなくても同じ）', () => {
    const expected = {
        files: ['to.vcf'],
        pdfOptions: {},
        separate: false,
        notices: [],
        help: false
    };
    assert.deepEqual(parseArgs(['--label-layout=letterpack', 'to.vcf']), expected);
    assert.deepEqual(parseArgs(['--label-layout', 'letterpack', 'to.vcf']), expected);
    assert.deepEqual(parseArgs(['--layout=letterpack', 'to.vcf']), expected);
    assert.deepEqual(parseArgs(['to.vcf']), expected);
    // 法務の記録・手順書の呼び出し
    assert.deepEqual(parseArgs(['--label-layout=letterpack', '--copper', 'to.vcf']), { ...expected, pdfOptions: { engine: 'copper' } });
    assert.throws(() => parseArgs(['--label-layout=yupack', 'to.vcf']), /--label-layout には letterpack を指定してください/);
    assert.throws(() => parseArgs(['--label-layout']), /--label-layout には letterpack を指定してください/);
});

test('address_label: 廃止した ordinary（普通郵便）を指定しても、エラーにせず案内を出す', () => {
    assert.match(RETIRED_LABEL_LAYOUT_NOTICE, /普通郵便の配置は廃止しました。レターパックの配置で作ります（破線で切れば定形封筒にも貼れます）/);
    for (const args of [['--label-layout=ordinary', 'to.vcf'], ['--label-layout', 'ordinary', 'to.vcf'], ['--layout=ordinary', 'to.vcf'], ['--layout', 'ordinary', 'to.vcf']]) {
        const parsed = parseArgs(args);
        assert.deepEqual(parsed.files, ['to.vcf'], args.join(' '));
        assert.deepEqual(parsed.notices, [RETIRED_LABEL_LAYOUT_NOTICE], args.join(' '));
    }
    // 案内は1回だけ
    assert.deepEqual(parseArgs(['--label-layout=ordinary', '--layout=ordinary', 'to.vcf']).notices, [RETIRED_LABEL_LAYOUT_NOTICE]);
});

test('address_label: ordinary を指定してもレターパックで作られ、標準エラーに案内が出る', () => {
    const ordinary = runAddressLabelCli(['--label-layout=ordinary']);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.ok(ordinary.stderr.includes(RETIRED_LABEL_LAYOUT_NOTICE), ordinary.stderr);
    assert.ok(!ordinary.stdout.includes('廃止'), '案内は標準出力ではなく標準エラーに出す');
    assert.ok(ordinary.captured, 'PDF 変換が呼ばれていない');
    assert.match(ordinary.captured.html, /<main class="label-page letterpack">/);
    assert.match(ordinary.captured.html, /<div class="cut-line cut-teikei"><\/div>/);
    assert.doesNotMatch(ordinary.captured.html, /ordinary|普通郵便/);
    assert.match(path.basename(ordinary.captured.outputPath), /^宛先_宛名ラベル_レターパック\.pdf$/);
    assert.equal(ordinary.captured.options.engine, 'copper');

    // 記録・手順書どおりの --label-layout=letterpack --copper と同じものができる（案内は出ない）
    const letterpack = runAddressLabelCli(['--label-layout=letterpack', '--copper']);
    assert.equal(letterpack.status, 0, letterpack.stderr);
    assert.ok(!letterpack.stderr.includes(RETIRED_LABEL_LAYOUT_NOTICE), letterpack.stderr);
    assert.equal(ordinary.captured.html, letterpack.captured.html);
    assert.equal(path.basename(ordinary.captured.outputPath), path.basename(letterpack.captured.outputPath));
    assert.deepEqual(ordinary.captured.options, letterpack.captured.options);
});

test('address_label: PDF は既定で Copper で組む（--copper を付けても付けなくても同じ）', () => {
    assert.equal(DEFAULT_PDF_ENGINE, 'copper');
    const plain = runAddressLabelCli([]);
    const copper = runAddressLabelCli(['--copper']);
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(copper.status, 0, copper.stderr);
    assert.equal(plain.captured.options.engine, 'copper');
    assert.deepEqual(plain.captured.options, copper.captured.options);
    assert.equal(plain.captured.html, copper.captured.html);
    assert.equal(plain.stderr, '');

    // --chrome を付ければ、1件のラベルは Chrome で組める
    const chrome = runAddressLabelCli(['--chrome']);
    assert.equal(chrome.status, 0, chrome.stderr);
    assert.equal(chrome.captured.options.engine, 'chrome');
});

test('GUI: 宛名ラベルの種別の欄はなく、ラベルには PDF エンジンも種別も渡さない', () => {
    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../src/gui/index.html'), 'utf-8');
    const renderer = fs.readFileSync(path.resolve(__dirname, '../src/gui/renderer.ts'), 'utf-8');
    assert.doesNotMatch(indexHtml, /optAddressLabelLayout|普通郵便|value="ordinary"/);
    assert.doesNotMatch(renderer, /--label-layout|optAddressLabelLayout/);
    // PDF エンジンを渡すのは PDF 変換だけ（宛名ラベルはラベル側の既定の Copper で組む）
    assert.match(renderer, /if \(currentScript === 'pdf'\) \{\s*opts\.push\(`--pdf-engine=/);
    assert.doesNotMatch(renderer, /currentScript === 'address_label'\) \{\s*opts\.push/);
});

test('address_label: parses --separate and keeps several recipient files', () => {
    const parsed = parseArgs(['--label-layout=letterpack', 'court.vcf', 'counsel.vcf']);
    assert.deepEqual(parsed.files, ['court.vcf', 'counsel.vcf']);
    assert.equal(parsed.separate, false);
    assert.equal(parseArgs(['--separate', 'court.vcf', 'counsel.vcf']).separate, true);
});

test('address_label: several recipients become one document with a page per recipient', () => {
    const sender = parseVCard(['BEGIN:VCARD', 'FN:宮部 龍彦', 'ADR:;;大師駅前1-3-11;川崎市川崎区;神奈川県;210-0802;', 'END:VCARD'].join('\n'));
    const court = parseVCard(['BEGIN:VCARD', 'FN:大阪地方裁判所 第22民事部合議2係', 'ADR:;;西天満2-1-10;大阪市北区;大阪府;530-8522;', 'END:VCARD'].join('\n'));
    const counsel = parseVCard(['BEGIN:VCARD', 'FN:暁法律事務所 弁護士 中井 雅人 様', 'ADR:;;西天満4-5-5 マーキス梅田601;大阪市北区;大阪府;530-0047;', 'END:VCARD'].join('\n'));

    const html = buildLabelsHtml([{ recipient: court, sender }, { recipient: counsel, sender }]);

    // 2件は A4 横の1頁に2枚並べる
    assert.equal((html.match(/<main class="label-page /g) || []).length, 2);
    assert.equal((html.match(/<div class="sheet">/g) || []).length, 1);
    assert.equal((html.match(/<!doctype html>/g) || []).length, 1);
    assert.match(html, /@page \{\s*size: A4 landscape;/);
    assert.match(html, /<body class="two-up">/);
    assert.match(html, /\.sheet \+ \.sheet \{\s*break-before:\s*page;/);
    assert.match(html, /\.sheet \.letterpack \.label-frame,[\s\S]*?left:\s*11\.75mm;\s*top:\s*27mm;/);
    assert.ok(html.indexOf('530-8522') < html.indexOf('530-0047'));

    // 3件なら2頁（2枚＋1枚）
    const three = buildLabelsHtml([{ recipient: court, sender }, { recipient: counsel, sender }, { recipient: court, sender }]);
    assert.equal((three.match(/<div class="sheet">/g) || []).length, 2);
    assert.equal((three.match(/<main class="label-page /g) || []).length, 3);

    // 1件なら従来と同じ A4 縦の1頁
    const single = buildLabelHtml(court, sender);
    assert.equal((single.match(/<main class="label-page /g) || []).length, 1);
    assert.doesNotMatch(single, /<div class="sheet">/);
    assert.match(single, /@page \{\s*size: A4;/);

    // 用紙の指定は印付きの style に置き、変換が A4 縦を差し込まないようにする
    assert.match(html, /<style data-houhi-a4-page-size>\s*@page \{\s*size: A4 landscape;/);
    // エンジンの既定は Copper。2枚並べる（A4 横）ときは --chrome でも Copper で組む
    assert.deepEqual(labelPdfOptions(1, {}), { engine: 'copper' });
    assert.deepEqual(labelPdfOptions(1, { engine: 'copper' }), labelPdfOptions(1, {}));
    assert.deepEqual(labelPdfOptions(2, {}), { engine: 'copper' });
    assert.equal(labelPdfOptions(2, { engine: 'chrome' }).engine, 'copper');
    assert.deepEqual(labelPdfOptions(1, { engine: 'chrome' }), { engine: 'chrome' });

    // 並べないと指定したときは、宛先ごとに A4 縦の頁
    const separatePages = buildLabelsHtml([{ recipient: court, sender }, { recipient: counsel, sender }], { twoUp: false });
    assert.doesNotMatch(separatePages, /<div class="sheet">/);
    assert.match(separatePages, /@page \{\s*size: A4;/);
    assert.match(separatePages, /body > \.label-page \+ \.label-page \{\s*break-before:\s*page;/);
});

test('address_label: parses pdf engine option', () => {
    assert.deepEqual(parseArgs(['--pdf-engine=copper', '--label-layout=letterpack', 'to.vcf']), {
        files: ['to.vcf'],
        pdfOptions: { engine: 'copper' },
        separate: false,
        notices: [],
        help: false
    });
    assert.equal(parseArgs(['--chrome', 'to.vcf']).pdfOptions.engine, 'chrome');
    assert.equal(parseArgs(['--copper', 'to.vcf']).pdfOptions.engine, 'copper');
    assert.throws(() => parseArgs(['--pdf-engine=unknown', 'to.vcf']), /copper または chrome/);
});

test('address_label: letterpack HTML follows reference SVG frame and uses stronger cut guide with 18pt text', () => {
    const recipient = parseVCard([
        'BEGIN:VCARD',
        'FN:さいたま地方裁判所',
        'TEL:048-863-9612',
        'ADR:;;高砂 3-16-45;さいたま市 浦和区;埼玉県;330-0063;',
        'END:VCARD'
    ].join('\n'));
    const sender = parseVCard([
        'BEGIN:VCARD',
        'FN:宮部 龍彦',
        'TEL:080-1442-9144',
        'ADR:;;大師駅前 1-3-11 第2松坂荘 101号;川崎市 川崎区;神奈川県;210-0802;',
        'END:VCARD'
    ].join('\n'));

    const html = buildLabelHtml(recipient, sender);

    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*left:\s*22\.2395mm;/);
    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*top:\s*49\.1537mm;/);
    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*width:\s*125mm;/);
    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*height:\s*156mm;/);
    assert.match(html, /\.letterpack \.guide \{[\s\S]*display:\s*none;/);
    assert.match(html, /\.letterpack \.cut-top \{[\s\S]*left:\s*22\.2395mm;[\s\S]*top:\s*49\.1537mm;[\s\S]*width:\s*125mm;[\s\S]*border-top:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.cut-right \{[\s\S]*left:\s*147\.2395mm;[\s\S]*height:\s*156mm;[\s\S]*border-right:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.cut-bottom \{[\s\S]*top:\s*205\.1537mm;[\s\S]*width:\s*125mm;[\s\S]*border-top:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.cut-left \{[\s\S]*left:\s*22\.2395mm;[\s\S]*height:\s*156mm;[\s\S]*border-left:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.separator \{[\s\S]*top:\s*66\.2454mm;/);
    assert.match(html, /\.letterpack \{[\s\S]*--address-size:\s*18pt;/);
    assert.match(html, /\.letterpack \{[\s\S]*--name-size:\s*18pt;/);
    assert.match(html, /class="contact-fit" style="--postal-size:\d+(?:\.\d)?pt;--address-size:\d+(?:\.\d)?pt;--name-size:\d+(?:\.\d)?pt;--phone-size:\d+(?:\.\d)?pt"/);
    assert.match(html, /さいたま地方裁判所 御中/);
    assert.match(html, /宮部 龍彦/);
});

test('address_label: auto font size shrinks long letterpack labels and expands short ones', () => {
    const longRecipient = parseVCard([
        'BEGIN:VCARD',
        'FN:最高裁判所 秘書課文書開示第二係',
        'TEL:03-4233-5240',
        'ADR:;;隼町4番2号 とても長い建物名と部署名が続く;千代田区;東京都;102-8651;',
        'END:VCARD'
    ].join('\n'));
    const shortSender = parseVCard([
        'BEGIN:VCARD',
        'FN:宮部 龍彦',
        'TEL:080-1442-9144',
        'ADR:;;大師駅前1-3-11;川崎市;神奈川県;210-0802;',
        'END:VCARD'
    ].join('\n'));

    const html = buildLabelHtml(longRecipient, shortSender);
    const sizes = Array.from(html.matchAll(/--postal-size:(\d+(?:\.\d)?)pt/g)).map(match => Number(match[1]));

    assert.equal(sizes.length, 2);
    // 区画は定形郵便と共用できるよう幅 92mm（外枠の左端から 100mm 以内）。長い宛先は縮め、短い差出人は大きく保つ
    assert.ok(sizes[0] < 18, `long recipient should shrink: ${sizes[0]}`);
    assert.ok(sizes[1] > sizes[0] + 4, `short sender should stay larger: ${sizes[1]}`);
});

test('address_label: letterpack contact blocks fit within 100mm for standard-size mail', () => {
    const contact = parseVCard(['BEGIN:VCARD', 'FN:甲野 太郎', 'ADR:;;1-1-1;千代田区;東京都;100-0001;', 'END:VCARD'].join('\n'));
    const html = buildLabelHtml(contact, contact);

    assert.match(html, /\.letterpack \.recipient \{[\s\S]*?width:\s*92mm;/);
    assert.match(html, /\.letterpack \.sender \{[\s\S]*?width:\s*92mm;/);
    assert.match(html, /\.letterpack \.cut-teikei \{[\s\S]*?left:\s*122\.2395mm;/);
    assert.match(html, /<div class="cut-line cut-teikei"><\/div>/);
});

test('address_label: ラベルはレターパックの配置だけで、普通郵便の配置は残っていない', () => {
    const contact = parseVCard([
        'BEGIN:VCARD',
        'FN:甲野 太郎',
        'ADR:;;1-1-1;千代田区;東京都;100-0001;',
        'END:VCARD'
    ].join('\n'));

    const html = buildLabelHtml(contact, contact);

    assert.match(html, /<html lang="ja" data-houhi-address-label="letterpack">/);
    assert.match(html, /<title>レターパック宛名ラベル<\/title>/);
    assert.match(html, /<main class="label-page letterpack">/);
    assert.doesNotMatch(html, /ordinary|普通郵便/);
});

test('address_label: letterpack label extends below the sender block with the item name', () => {
    const base = {
        name: '第15民事部 御中',
        organization: '東京高等裁判所',
        phone: '',
        nameNote: '',
        item: '',
        address: { postalCode: '1008933', region: '', locality: '', street: '東京都千代田区霞が関1-1-4', extended: '東京高等裁判所', country: '日本', label: '' }
    };
    const sender = { ...base, name: '宮部 龍彦', organization: '', item: '' };
    const html = buildLabelHtml(base, sender);
    assert.match(html, /<div class="item-name">書類<\/div>/);
    assert.match(html, /<div class="item-checks"><span class="item-check">リチウム電池なし<\/span><span class="item-check">高圧ガスなし<\/span><span class="item-check">引火性液体なし<\/span><\/div>/);
    assert.match(html, /\.letterpack \.item-check::before \{[\s\S]*content: "☑";/);
    assert.doesNotMatch(html, /品名　/);
    assert.match(html, /\.letterpack \.separator-item \{[\s\S]*top:\s*119\.7994mm;/);

    const custom = buildLabelHtml({ ...base, item: '証拠書類' }, sender);
    assert.match(custom, /<div class="item-name">証拠書類<\/div>/);
});

// ─── TECH-20260928-001: Copper で組んだときの行の長さ・高さ ─────────
// 2026-10-09 に Copper（cti.li）で合成データを組んで実測した値。
// - 和文は 1em、半角数字は 0.556em（Helvetica）
// - 漢字・かなと半角英数字のあいだに 0.25em の空き（和欧間）が入る
// - 和文と半角の字（数字・ハイフン）が混じる行は、行の高さが 0.104em 増える。
//   半角は空白だけの行（氏名）は 0.02em 増える
const PT_PER_MM = 72 / 25.4;
const COPPER_DIGIT_EM = 0.556;
const COPPER_WAOU_EM = 0.25;
const COPPER_MIXED_LINE_EM = 0.104;
const COPPER_SPACE_ONLY_LINE_EM = 0.02;

function letterpackContact(name, labelLines, phone) {
    return {
        name,
        organization: '',
        phone,
        nameNote: '',
        item: '',
        address: { postalCode: '', region: '', locality: '', street: '', extended: '', country: '', label: labelLines.join('\n') }
    };
}

function contactFontSizes(html) {
    return Array.from(html.matchAll(/--address-size:(\d+(?:\.\d)?)pt/g)).map(match => Number(match[1]));
}

// レターパックの1区画の高さ（pt）を、Copper の実測どおりに見積もる。
// lines は行の高さ（em）。郵便番号・住所・氏名・電話の間の空き（3mm・3mm・2mm）を足す
function copperLetterpackHeightPt(sizePt, lineEms) {
    const gapsPt = (3 + 3 + 2) * PT_PER_MM;
    return sizePt * lineEms.reduce((sum, em) => sum + em, 0) + gapsPt;
}

test('address_label: レターパックの宛先住所が、Copper の和欧間の空きを入れても1行に収まる', () => {
    const recipient = letterpackContact('見本局 総務課', ['〒540-0008', '大阪府大阪市中央区大手前三丁目1番41号', '見本合同庁舎第9号館'], '06-0000-0000');
    recipient.address.postalCode = '540-0008';
    const sender = letterpackContact('見本 太郎', ['〒100-0001', '東京都千代田区千代田1丁目1番1号'], '090-0000-0000');
    sender.address.postalCode = '100-0001';

    const [recipientSize] = contactFontSizes(buildLabelHtml(recipient, sender));
    // 「大阪府大阪市中央区大手前三丁目1番41号」は 和文17字・半角数字3字・和欧間4か所
    const lineWidthPt = recipientSize * (17 + 3 * COPPER_DIGIT_EM + 4 * COPPER_WAOU_EM);
    const boxWidthPt = 110 * PT_PER_MM;
    assert.ok(lineWidthPt <= boxWidthPt, `${recipientSize}pt で ${lineWidthPt.toFixed(1)}pt。枠は ${boxWidthPt.toFixed(1)}pt`);
});

test('address_label: レターパックの差出人欄の高さが、Copper の行の広がりを入れても箱の 45.8mm に収まる', () => {
    const recipient = letterpackContact('見本局 総務課', ['大阪府大阪市中央区大手前三丁目1番41号'], '');
    const sender = letterpackContact('見本 太郎', ['〒100-0001', '東京都千代田区千代田1丁目1番1号', '見本マンション101号'], '090-0000-0000');
    sender.address.postalCode = '100-0001';

    const [, senderSize] = contactFontSizes(buildLabelHtml(recipient, sender));
    const heightPt = copperLetterpackHeightPt(senderSize, [
        1.2 + COPPER_MIXED_LINE_EM,  // 〒100-0001
        1.04 + COPPER_MIXED_LINE_EM, // 東京都千代田区千代田1丁目1番1号
        1.04 + COPPER_MIXED_LINE_EM, // 見本マンション101号
        1.25 + COPPER_SPACE_ONLY_LINE_EM, // 見本 太郎
        1.2 + COPPER_MIXED_LINE_EM,  // ℡ 090-0000-0000
    ]);
    assert.ok(heightPt <= 45.8 * PT_PER_MM, `${senderSize}pt で ${(heightPt / PT_PER_MM).toFixed(1)}mm`);
});

test('address_label: レターパックの宛先欄の高さが、Copper の行の広がりを入れても 58mm に収まる', () => {
    // 短い行が多い宛先。幅ではなく高さで文字の大きさが決まる
    const recipient = letterpackContact('見本局 総務課', ['〒540-0008', '大阪市中央区1丁目2番3号', '見本ビル4階', '第5会議室', '受付窓口6番'], '06-0000-0000');
    recipient.address.postalCode = '540-0008';
    const sender = letterpackContact('見本 太郎', ['東京都千代田区千代田1丁目1番1号'], '');

    const [recipientSize] = contactFontSizes(buildLabelHtml(recipient, sender));
    const heightPt = copperLetterpackHeightPt(recipientSize, [
        1.2 + COPPER_MIXED_LINE_EM,  // 〒540-0008
        1.04 + COPPER_MIXED_LINE_EM, // 大阪市中央区1丁目2番3号
        1.04 + COPPER_MIXED_LINE_EM, // 見本ビル4階
        1.04 + COPPER_MIXED_LINE_EM, // 第5会議室
        1.04 + COPPER_MIXED_LINE_EM, // 受付窓口6番
        1.25 + COPPER_SPACE_ONLY_LINE_EM, // 見本局 総務課 御中
        1.2 + COPPER_MIXED_LINE_EM,  // ℡ 06-0000-0000
    ]);
    assert.ok(heightPt <= 58 * PT_PER_MM, `${recipientSize}pt で ${(heightPt / PT_PER_MM).toFixed(1)}mm`);
});
