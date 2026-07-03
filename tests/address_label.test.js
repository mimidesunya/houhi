const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SENDER_VCARD_FILE_NAME,
    buildLabelHtml,
    cleanPostalCode,
    formatAddressLines,
    parseArgs,
    parseVCard
} = require('../dist/src/address_label.js');

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

test('address_label: parses layout option', () => {
    assert.deepEqual(parseArgs(['--label-layout=letterpack', 'to.vcf']), {
        files: ['to.vcf'],
        layout: 'letterpack',
        pdfOptions: {},
        help: false
    });
});

test('address_label: parses pdf engine option', () => {
    assert.deepEqual(parseArgs(['--pdf-engine=copper', '--label-layout=letterpack', 'to.vcf']), {
        files: ['to.vcf'],
        layout: 'letterpack',
        pdfOptions: { engine: 'copper' },
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

    const html = buildLabelHtml(recipient, sender, 'letterpack');

    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*left:\s*22\.2395mm;/);
    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*top:\s*49\.1537mm;/);
    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*width:\s*124\.7994mm;/);
    assert.match(html, /\.letterpack \.label-frame \{[\s\S]*height:\s*119\.7994mm;/);
    assert.match(html, /\.letterpack \.guide \{[\s\S]*display:\s*none;/);
    assert.match(html, /\.letterpack \.cut-top \{[\s\S]*left:\s*22\.2395mm;[\s\S]*top:\s*49\.1537mm;[\s\S]*width:\s*124\.7994mm;[\s\S]*border-top:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.cut-right \{[\s\S]*left:\s*147\.0389mm;[\s\S]*height:\s*119\.7994mm;[\s\S]*border-right:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.cut-bottom \{[\s\S]*top:\s*168\.9531mm;[\s\S]*width:\s*124\.7994mm;[\s\S]*border-top:\s*0\.16mm dotted #000;/);
    assert.match(html, /\.letterpack \.cut-left \{[\s\S]*left:\s*22\.2395mm;[\s\S]*height:\s*119\.7994mm;[\s\S]*border-left:\s*0\.16mm dotted #000;/);
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

    const html = buildLabelHtml(longRecipient, shortSender, 'letterpack');
    const sizes = Array.from(html.matchAll(/--postal-size:(\d+(?:\.\d)?)pt/g)).map(match => Number(match[1]));

    assert.equal(sizes.length, 2);
    assert.ok(sizes[0] < 22, `long recipient should shrink: ${sizes[0]}`);
    assert.ok(sizes[1] > 20, `short sender should expand: ${sizes[1]}`);
});

test('address_label: ordinary HTML uses 16pt text and compact envelope label frame', () => {
    const contact = parseVCard([
        'BEGIN:VCARD',
        'FN:甲野 太郎',
        'ADR:;;1-1-1;千代田区;東京都;100-0001;',
        'END:VCARD'
    ].join('\n'));

    const html = buildLabelHtml(contact, contact, 'ordinary');

    assert.match(html, /\.ordinary \.label-frame \{[\s\S]*width:\s*100mm;/);
    assert.match(html, /\.ordinary \.label-frame \{[\s\S]*height:\s*95mm;/);
    assert.match(html, /--postal-size:\s*16pt;/);
    assert.match(html, /--name-size:\s*16pt;/);
});
