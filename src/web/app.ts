import { convertMarkdownToCourtHtml } from '../base/court_markdown';
import { applyManualPageNumbers, fillChromeTocPageNumbers, prepareChromeToc } from '../lib/paged_toc';

const DEFAULT_MARKDOWN = `# 準備書面

### 目次

## 第1 請求の趣旨
原告の請求をいずれも棄却する。

## 第2 請求の原因に対する認否
1 原告の主張する契約締結の事実は否認する。

(1) 原告が提出する電子メールは、交渉経過の一部を示すものにすぎない。

(2) 代金額、納期、成果物の範囲について最終的な合意は成立していない。

## 第3 被告の主張
1 本件では、当事者間において契約の主要部分について合意がない。

2 仮に何らかの合意が認められるとしても、原告の主張する損害額は根拠を欠く。

### --右
令和8年5月31日
被告訴訟代理人弁護士　〇〇　〇〇
### --

以上
`;

const editor = document.getElementById('markdownInput') as HTMLTextAreaElement;
const dropZone = document.getElementById('dropZone') as HTMLElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const previewFrame = document.getElementById('previewFrame') as HTMLIFrameElement;
const statusText = document.getElementById('previewStatus') as HTMLElement;
const renderButton = document.getElementById('renderButton') as HTMLButtonElement;
const htmlPreviewButton = document.getElementById('htmlPreviewButton') as HTMLButtonElement;
const printButton = document.getElementById('printButton') as HTMLButtonElement;
const pasteButton = document.getElementById('pasteButton') as HTMLButtonElement;

let renderSeq = 0;

function setStatus(message: string) {
    statusText.textContent = message;
}

function escapeScriptEnd(value: string) {
    return value.replace(/<\/script/gi, '<\\/script');
}

function escapeHtmlAttribute(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function prepareTocPlaceholders(html: string) {
    return html.replace(/<cssj:make-toc\b[^>]*>\s*<\/cssj:make-toc>/gi, () => {
        return '<ul class="cssj-toc houhi-chrome-toc" data-houhi-chrome-toc="pending"></ul>';
    });
}

function buildPreviewDocument(markdown: string) {
    const bodyHtml = prepareTocPlaceholders(convertMarkdownToCourtHtml(markdown));
    const baseHref = new URL('./', window.location.href).href;

    return `<!doctype html>
<html lang="ja" data-houhi-pdf-engine="chrome">
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <link rel="stylesheet" href="court.css">
  <style>
    html, body { background: #fff; }
    body { padding: 0; }
    body, body * {
      font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif;
    }
    .content-container { background: #fff; font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif; }
    @media screen {
      .pagedjs_pages { margin: 24px auto; }
      .pagedjs_page { background: #fff; }
      .pagedjs_sheet { background: #fff; }
    }
  </style>
  <script>
    window.PagedConfig = window.PagedConfig || {};
    window.PagedConfig.auto = false;
  </script>
  <script src="vendor/paged.polyfill.min.js"></script>
</head>
<body>
  <main class="content-container">
${bodyHtml}
  </main>
  <script>
    window.__houhiPreviewSourceReady = true;
  </script>
</body>
</html>`;
}

function preparePlainHtmlBody(bodyHtml: string) {
    const template = document.createElement('template');
    template.innerHTML = bodyHtml;

    const tocItems = Array.from(template.content.querySelectorAll('li.heading-item h1, li.heading-item h2, li.heading-item h3, li.heading-item h4, li.heading-item h5, li.heading-item h6'))
        .map((heading, index) => {
            const id = `houhi-heading-${index + 1}`;
            heading.setAttribute('id', id);
            return {
                id,
                title: heading.textContent?.trim() || '',
            };
        })
        .filter(item => item.title.length > 0);

    const container = document.createElement('div');
    container.appendChild(template.content.cloneNode(true));
    const preparedHtml = container.innerHTML;
    const tocHtml = tocItems.length > 0
        ? `<ul class="cssj-toc plain-toc">${tocItems.map(item => `<li><a href="#${item.id}"><span class="cssj-title">${escapeHtmlAttribute(item.title)}</span></a></li>`).join('')}</ul>`
        : '';

    return preparedHtml.replace(/<cssj:make-toc\b[^>]*>\s*<\/cssj:make-toc>/gi, tocHtml);
}

function buildPlainHtmlDocument(markdown: string) {
    const bodyHtml = preparePlainHtmlBody(convertMarkdownToCourtHtml(markdown));
    const baseHref = new URL('./', window.location.href).href;

    return `<!doctype html>
<html lang="ja" data-houhi-pdf-engine="plain-html">
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <title>法匪 HTML表示</title>
  <link rel="stylesheet" href="court.css">
  <style>
    html {
      background: #f4f4f1;
      scroll-behavior: smooth;
    }
    body {
      margin: 0;
      background: #f4f4f1;
    }
    body:before {
      content: none;
    }
    body, body * {
      font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif;
    }
    .content-container {
      box-sizing: border-box;
      max-width: 840px;
      min-height: 100vh;
      margin: 0 auto;
      padding: 42px 54px 84px;
      background: #fff;
      font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif;
    }
    .break {
      margin: 2.2em 0;
      padding-top: 0.8em;
      border-top: 1px dashed #bbb;
      color: #666;
      text-align: center;
    }
    ul.plain-toc span.cssj-page,
    ul.plain-toc span.cssj-leader {
      display: none;
    }
    @media (max-width: 720px) {
      .content-container {
        padding: 28px 22px 64px;
      }
    }
  </style>
</head>
<body>
  <main class="content-container">
${bodyHtml}
  </main>
</body>
</html>`;
}

function waitForFrameLoad(frame: HTMLIFrameElement) {
    return new Promise<void>(resolve => {
        frame.addEventListener('load', () => resolve(), { once: true });
    });
}

function waitForPaged(frameWindow: Window) {
    return new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const check = () => {
            if ((frameWindow as any).PagedPolyfill && typeof (frameWindow as any).PagedPolyfill.preview === 'function') {
                resolve();
                return;
            }
            if (Date.now() - startedAt > 12000) {
                reject(new Error('Paged.js の読み込みがタイムアウトしました。'));
                return;
            }
            frameWindow.setTimeout(check, 50);
        };
        check();
    });
}

function nextFrame(frameWindow: Window) {
    return new Promise<void>(resolve => {
        frameWindow.requestAnimationFrame(() => {
            frameWindow.requestAnimationFrame(() => resolve());
        });
    });
}

async function renderPreviewNow() {
    const seq = ++renderSeq;
    const markdown = editor.value.trim() ? editor.value : DEFAULT_MARKDOWN;
    setStatus('組版中...');
    renderButton.disabled = true;

    const loaded = waitForFrameLoad(previewFrame);
    previewFrame.srcdoc = buildPreviewDocument(markdown);
    await loaded;
    if (seq !== renderSeq) return;

    const frameWindow = previewFrame.contentWindow;
    const frameDocument = previewFrame.contentDocument;
    if (!frameWindow || !frameDocument) {
        setStatus('プレビューを作成できませんでした。');
        return;
    }

    try {
        await waitForPaged(frameWindow);
        if (frameDocument.fonts && frameDocument.fonts.ready) {
            await frameDocument.fonts.ready;
        }
        await nextFrame(frameWindow);
        prepareChromeToc(frameDocument);
        await (frameWindow as any).PagedPolyfill.preview();
        fillChromeTocPageNumbers(frameDocument);
        applyManualPageNumbers(frameDocument);
        setStatus('プレビュー更新済み');
    } catch (err) {
        console.error(err);
        setStatus(err instanceof Error ? err.message : 'プレビュー作成中にエラーが発生しました。');
    } finally {
        renderButton.disabled = false;
    }
}

function markPreviewDirty() {
    setStatus('未更新');
}

function openPlainHtmlPreview() {
    const markdown = editor.value.trim() ? editor.value : DEFAULT_MARKDOWN;
    const html = buildPlainHtmlDocument(markdown);
    const blob = new Blob([escapeScriptEnd(html)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const tab = window.open('about:blank', '_blank');

    if (!tab) {
        URL.revokeObjectURL(url);
        setStatus('別タブを開けませんでした。ポップアップ許可を確認してください。');
        return;
    }

    tab.opener = null;
    tab.location.href = url;
    setStatus('HTML表示を別タブで開きました。');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function pasteFromClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        editor.focus();
        setStatus('このブラウザではボタンから貼り付けできません。入力欄で貼り付けてください。');
        return;
    }

    pasteButton.disabled = true;
    try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
            editor.focus();
            setStatus('クリップボードにテキストがありません。');
            return;
        }
        editor.value = text;
        await renderPreviewNow();
    } catch (err) {
        console.error(err);
        editor.focus();
        setStatus('貼り付けを許可できませんでした。入力欄で貼り付けてください。');
    } finally {
        pasteButton.disabled = false;
    }
}

async function loadFile(file: File) {
    if (!/\.md$/i.test(file.name)) {
        setStatus('.md ファイルを指定してください。');
        return;
    }
    editor.value = await file.text();
    setStatus(`${file.name} を読み込みました。`);
    renderPreviewNow();
}

editor.addEventListener('input', markPreviewDirty);

dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        loadFile(file);
    }
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
        loadFile(file);
    }
});

pasteButton.addEventListener('click', pasteFromClipboard);

renderButton.addEventListener('click', renderPreviewNow);

htmlPreviewButton.addEventListener('click', openPlainHtmlPreview);

printButton.addEventListener('click', () => {
    const frameWindow = previewFrame.contentWindow;
    if (!frameWindow) return;
    frameWindow.focus();
    frameWindow.print();
});

editor.value = DEFAULT_MARKDOWN;
renderPreviewNow();
