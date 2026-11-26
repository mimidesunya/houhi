import { convertMarkdownToCourtHtml } from '../base/court_markdown';
import { checkCourtMarkdown, formatCourtCheckIssue, getCourtCheckLabel } from '../base/court_check';
import type { CourtCheckIssue } from '../base/court_check';
import { appendTemplateOptions } from '../lib/template_catalog';
import { buildPdfDocumentTitle } from './document_title';
import { normalizeEditableMarkdown } from './markdown_normalizer';
import { applyManualPageNumbers, fillChromeTocPageNumbers, prepareChromeToc } from '../lib/paged_toc';
import { registerPagedTableHandlers, showPagedOverflow } from '../lib/paged_tables';

type DraftingTemplate = {
    id: string;
    name: string;
    content: string;
    aiNotes?: string;
};

type DraftingData = {
    templates?: DraftingTemplate[];
};

const DEFAULT_MARKDOWN = `# 準備書面

### --目次

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
const previewSurface = document.getElementById('previewSurface') as HTMLElement;
const previewViewport = document.getElementById('previewViewport') as HTMLElement;
const previewFrame = document.getElementById('previewFrame') as HTMLIFrameElement;
const statusText = document.getElementById('previewStatus') as HTMLElement;
const renderButton = document.getElementById('renderButton') as HTMLButtonElement;
const htmlPreviewButton = document.getElementById('htmlPreviewButton') as HTMLButtonElement;
const printButton = document.getElementById('printButton') as HTMLButtonElement;
const pasteButton = document.getElementById('pasteButton') as HTMLButtonElement;
const templateLoader = document.getElementById('templateLoader') as HTMLElement | null;
const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement | null;
const assetDropZone = document.getElementById('assetDropZone') as HTMLElement;
const imageFileButton = document.getElementById('imageFileButton') as HTMLButtonElement;
const imageFolderButton = document.getElementById('imageFolderButton') as HTMLButtonElement;
const imageFileInput = document.getElementById('imageFileInput') as HTMLInputElement;
const imageDirectoryInput = document.getElementById('imageDirectoryInput') as HTMLInputElement;
const imageAssetList = document.getElementById('imageAssetList') as HTMLElement;
const courtCheckSummary = document.getElementById('courtCheckSummary') as HTMLElement | null;
const courtCheckList = document.getElementById('courtCheckList') as HTMLElement | null;

let renderSeq = 0;
let courtCheckTimer = 0;
let courtCheckIssues: CourtCheckIssue[] = [];

// プレビューと印刷の字形を Windows・Mac で同じにするため、Noto Serif JP を Web フォントで読み込む。
// 読み込めないとき（オフラインなど）は、端末の明朝体で組む
const PREVIEW_FONT_FAMILY = '"Noto Serif JP", "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif';
const PREVIEW_FONT_STYLESHEET = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=block';
const PREVIEW_FONT_TIMEOUT_MS = 15000;

type LocalInputFile = {
    file: File;
    path: string;
};

type ImageAsset = {
    file: File;
    sourcePath: string;
    url: string;
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const imageAssets = new Map<string, ImageAsset>();
let currentMarkdownPath = '';

type PreviewZoomState = {
    scale: number;
    fitScale: number;
    manual: boolean;
    baseWidth: number;
    baseHeight: number;
    startDistance: number;
    startScale: number;
};

const PREVIEW_BASE_WIDTH = 840;
const PREVIEW_BASE_HEIGHT = 720;
const MIN_PREVIEW_SCALE = 0.18;
const MAX_PREVIEW_SCALE = 3;
let previewZoom: PreviewZoomState = {
    scale: 1,
    fitScale: 1,
    manual: false,
    baseWidth: PREVIEW_BASE_WIDTH,
    baseHeight: PREVIEW_BASE_HEIGHT,
    startDistance: 0,
    startScale: 1,
};

function setStatus(message: string) {
    statusText.textContent = message;
}

function getDraftingTemplates() {
    const data = (window as any).HOUHI_DRAFTING_DATA as DraftingData | undefined;
    return Array.isArray(data?.templates) ? data.templates : [];
}

function stripTemplateAiNotes(markdown: string) {
    return String(markdown || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function getTouchDistance(touches: TouchList) {
    if (touches.length < 2) return 0;

    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
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

function normalizeLocalPath(value: string) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/^\.\//, '')
        .replace(/\/{2,}/g, '/')
        .trim();
}

function getExtname(value: string) {
    const name = normalizeLocalPath(value).split('/').pop() || '';
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function getBasename(value: string) {
    const normalized = normalizeLocalPath(value);
    return normalized.split('/').pop() || normalized;
}

function getDirname(value: string) {
    const normalized = normalizeLocalPath(value);
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index) : '';
}

function joinLocalPath(base: string, leaf: string) {
    const raw = base ? `${base}/${leaf}` : leaf;
    const parts = normalizeLocalPath(raw).split('/').filter(Boolean);
    const out: string[] = [];
    for (const part of parts) {
        if (part === '.') continue;
        if (part === '..') {
            out.pop();
            continue;
        }
        out.push(part);
    }
    return out.join('/');
}

function relativeLocalPath(fromDir: string, toPath: string) {
    const fromParts = normalizeLocalPath(fromDir).split('/').filter(Boolean);
    const toParts = normalizeLocalPath(toPath).split('/').filter(Boolean);
    let common = 0;
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
        common++;
    }

    const up = fromParts.slice(common).map(() => '..');
    const down = toParts.slice(common);
    const relative = [...up, ...down].join('/');
    return relative || getBasename(toPath);
}

function displayPathForAsset(asset: ImageAsset) {
    if (!currentMarkdownPath) {
        return asset.sourcePath;
    }

    return relativeLocalPath(getDirname(currentMarkdownPath), asset.sourcePath);
}

function markdownTagForAsset(asset: ImageAsset) {
    return `![説明](${displayPathForAsset(asset)})`;
}

function isImagePath(value: string) {
    return IMAGE_EXTENSIONS.has(getExtname(value));
}

function isExternalImageSrc(value: string) {
    return /^(?:https?:|data:|blob:|about:|#)/i.test(String(value || '').trim());
}

function decodeImageSrc(value: string) {
    const withoutHash = String(value || '').split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    try {
        return decodeURIComponent(withoutQuery);
    } catch (_err) {
        return withoutQuery;
    }
}

function makeLocalInputFile(file: File, fallbackPath = ''): LocalInputFile {
    const filePath = (file as any).webkitRelativePath || fallbackPath || file.name;
    return {
        file,
        path: normalizeLocalPath(filePath || file.name),
    };
}

function filesFromFileList(fileList: FileList | null) {
    return Array.from(fileList || []).map(file => makeLocalInputFile(file));
}

function fileFromEntry(entry: any) {
    return new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

function readDirectoryEntries(reader: any) {
    return new Promise<any[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
    });
}

async function collectEntryFiles(entry: any): Promise<LocalInputFile[]> {
    if (!entry) {
        return [];
    }

    if (entry.isFile) {
        const file = await fileFromEntry(entry);
        return [makeLocalInputFile(file, entry.fullPath || file.name)];
    }

    if (!entry.isDirectory) {
        return [];
    }

    const reader = entry.createReader();
    const files: LocalInputFile[] = [];
    for (;;) {
        const entries = await readDirectoryEntries(reader);
        if (!entries.length) {
            break;
        }
        for (const child of entries) {
            files.push(...await collectEntryFiles(child));
        }
    }
    return files;
}

async function collectDroppedFiles(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) {
        return [];
    }

    const items = Array.from(dataTransfer.items || []);
    const entries = items
        .map(item => typeof (item as any).webkitGetAsEntry === 'function' ? (item as any).webkitGetAsEntry() : null)
        .filter(Boolean);

    if (entries.length > 0) {
        const nested = await Promise.all(entries.map(entry => collectEntryFiles(entry)));
        return nested.flat();
    }

    return filesFromFileList(dataTransfer.files);
}

function resolveImageAsset(src: string) {
    const raw = decodeImageSrc(src);
    if (!raw || isExternalImageSrc(raw)) {
        return null;
    }

    const normalized = normalizeLocalPath(raw);
    const markdownDir = getDirname(currentMarkdownPath);
    const candidates = new Set<string>([
        normalized,
        markdownDir ? joinLocalPath(markdownDir, normalized) : normalized,
    ]);

    for (const candidate of candidates) {
        const exact = imageAssets.get(candidate);
        if (exact) {
            return exact;
        }
    }

    for (const asset of imageAssets.values()) {
        if (displayPathForAsset(asset) === normalized) {
            return asset;
        }
    }

    const basename = getBasename(normalized);
    const basenameMatches = Array.from(imageAssets.values()).filter(asset => getBasename(asset.sourcePath) === basename);
    return basenameMatches.length === 1 ? basenameMatches[0] : null;
}

function prepareImageSources(bodyHtml: string) {
    const template = document.createElement('template');
    template.innerHTML = bodyHtml;

    for (const img of Array.from(template.content.querySelectorAll('img[src]'))) {
        const src = img.getAttribute('src') || '';
        const asset = resolveImageAsset(src);
        if (!asset) {
            img.setAttribute('data-houhi-image-missing', src);
            continue;
        }
        img.setAttribute('src', asset.url);
        img.setAttribute('data-houhi-source-path', displayPathForAsset(asset));
    }

    const container = document.createElement('div');
    container.appendChild(template.content.cloneNode(true));
    return container.innerHTML;
}

function waitForImages(frameDocument: Document) {
    const images = Array.from(frameDocument.images || []);
    const pending = images
        .filter(img => !img.complete)
        .map(img => new Promise<void>(resolve => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
        }));

    if (!pending.length) {
        return Promise.resolve();
    }

    return Promise.race([
        Promise.all(pending).then(() => undefined),
        new Promise<void>(resolve => (frameDocument.defaultView || window).setTimeout(resolve, 10000)),
    ]);
}

function addImageFiles(files: LocalInputFile[]) {
    let added = 0;
    for (const item of files) {
        if (!isImagePath(item.path || item.file.name)) {
            continue;
        }

        const sourcePath = normalizeLocalPath(item.path || item.file.name);
        const old = imageAssets.get(sourcePath);
        if (old) {
            URL.revokeObjectURL(old.url);
        }
        imageAssets.set(sourcePath, {
            file: item.file,
            sourcePath,
            url: URL.createObjectURL(item.file),
        });
        added++;
    }
    renderImageAssetList();
    return added;
}

function insertAtCursor(text: string) {
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? editor.value.length;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n' : '';
    const insertion = `${prefix}${text}${suffix}`;
    editor.value = before + insertion + after;
    const cursor = before.length + insertion.length;
    editor.focus();
    editor.setSelectionRange(cursor, cursor);
    markPreviewDirty();
}

function renderImageAssetList() {
    imageAssetList.textContent = '';
    const assets = Array.from(imageAssets.values()).sort((a, b) => displayPathForAsset(a).localeCompare(displayPathForAsset(b), 'ja'));

    if (!assets.length) {
        const empty = document.createElement('p');
        empty.className = 'asset-empty';
        empty.textContent = '画像未読込';
        imageAssetList.appendChild(empty);
        return;
    }

    for (const asset of assets) {
        const row = document.createElement('div');
        row.className = 'image-asset-row';

        const thumb = document.createElement('img');
        thumb.className = 'image-asset-thumb';
        thumb.src = asset.url;
        thumb.alt = '';

        const meta = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'image-asset-name';
        name.title = displayPathForAsset(asset);
        name.textContent = displayPathForAsset(asset);
        const code = document.createElement('code');
        code.className = 'image-asset-code';
        code.textContent = markdownTagForAsset(asset);
        meta.append(name, code);

        const insertButton = document.createElement('button');
        insertButton.type = 'button';
        insertButton.textContent = '挿入';
        insertButton.dataset.insertImagePath = displayPathForAsset(asset);

        row.append(thumb, meta, insertButton);
        imageAssetList.appendChild(row);
    }
}

function prepareTocPlaceholders(html: string) {
    return html.replace(/<cssj:make-toc\b[^>]*>\s*<\/cssj:make-toc>/gi, () => {
        return '<ul class="cssj-toc houhi-chrome-toc" data-houhi-chrome-toc="pending"></ul>';
    });
}

function buildPreviewDocument(markdown: string) {
    const bodyHtml = prepareTocPlaceholders(prepareImageSources(convertMarkdownToCourtHtml(markdown)));
    const baseHref = new URL('./', window.location.href).href;
    const documentTitle = escapeHtmlAttribute(buildPdfDocumentTitle(markdown));

    return `<!doctype html>
<html lang="ja" data-houhi-pdf-engine="chrome">
<head>
  <meta charset="utf-8">
  <title>${documentTitle}</title>
  <base href="${baseHref}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${PREVIEW_FONT_STYLESHEET}">
  <link rel="stylesheet" href="court.css">
  <style>
    html, body { background: #fff; }
    body { padding: 0; }
    body, body * {
      font-family: ${PREVIEW_FONT_FAMILY};
    }
    .content-container { background: #fff; font-family: ${PREVIEW_FONT_FAMILY}; }
    @page { size: A4; }
    @media screen {
      html, body { overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; }
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
    const bodyHtml = preparePlainHtmlBody(prepareImageSources(convertMarkdownToCourtHtml(markdown)));
    const baseHref = new URL('./', window.location.href).href;

    return `<!doctype html>
<html lang="ja" data-houhi-pdf-engine="plain-html">
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <title>法匪 HTML表示</title>
  <link rel="stylesheet" href="${PREVIEW_FONT_STYLESHEET}">
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
      font-family: ${PREVIEW_FONT_FAMILY};
    }
    @page { size: A4; }
    .content-container {
      box-sizing: border-box;
      max-width: 840px;
      min-height: 100vh;
      margin: 0 auto;
      padding: 42px 54px 84px;
      background: #fff;
      font-family: ${PREVIEW_FONT_FAMILY};
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

/**
 * 組む前に、本文に使う字の Noto Serif JP（標準・太字）を読み込む。Google Fonts は字の範囲ごとにファイルが分かれ、
 * 使う字が画面に出たときに読み込むので、paged.js が頁を割る前に読み込んでおかないと、割った後で字幅が変わる。
 * 読み込めたかどうかを html の data-houhi-web-font に書く（試験と、印刷前の確認に使う）。
 */
async function loadPreviewFonts(frameDocument: Document) {
    const fonts = (frameDocument as any).fonts;
    const root = frameDocument.documentElement;
    if (!fonts || typeof fonts.load !== 'function') {
        root.setAttribute('data-houhi-web-font', 'unsupported');
        return false;
    }

    const text = `${frameDocument.body?.textContent || ''}- 0123456789`;
    const chars = Array.from(new Set(Array.from(text.replace(/\s+/g, '')))).join('');
    const timeout = new Promise<'timeout'>(resolve => (frameDocument.defaultView || window).setTimeout(() => resolve('timeout'), PREVIEW_FONT_TIMEOUT_MS));
    try {
        await Promise.race([
            Promise.all([
                fonts.load('400 16px "Noto Serif JP"', chars),
                fonts.load('700 16px "Noto Serif JP"', chars),
            ]),
            timeout,
        ]);
        await Promise.race([fonts.ready, timeout]);
    } catch (err) {
        console.warn('Noto Serif JP を読み込めませんでした。', err);
    }

    const loaded = Array.from(fonts as Iterable<any>).some(face => /Noto Serif JP/.test(face.family) && face.status === 'loaded');
    root.setAttribute('data-houhi-web-font', loaded ? 'loaded' : 'fallback');
    return loaded;
}

function nextFrame(frameWindow: Window) {
    return new Promise<void>(resolve => {
        frameWindow.requestAnimationFrame(() => {
            frameWindow.requestAnimationFrame(() => resolve());
        });
    });
}

function resetPreviewZoom() {
    previewZoom = {
        scale: 1,
        fitScale: 1,
        manual: false,
        baseWidth: PREVIEW_BASE_WIDTH,
        baseHeight: PREVIEW_BASE_HEIGHT,
        startDistance: 0,
        startScale: 1,
    };
    previewFrame.style.width = `${PREVIEW_BASE_WIDTH}px`;
    previewFrame.style.height = `${PREVIEW_BASE_HEIGHT}px`;
    previewFrame.style.transform = 'scale(1)';
    applyPreviewZoom();
}

function measurePreviewSize(frameDocument: Document) {
    const pages = frameDocument.querySelector('.pagedjs_pages') as HTMLElement | null;
    const doc = frameDocument.documentElement;
    const body = frameDocument.body;
    const width = Math.ceil(Math.max(
        PREVIEW_BASE_WIDTH,
        pages?.scrollWidth || 0,
        pages?.offsetWidth || 0
    ));
    const height = Math.ceil(Math.max(
        PREVIEW_BASE_HEIGHT,
        doc?.scrollHeight || 0,
        body?.scrollHeight || 0,
        pages?.scrollHeight || 0,
        pages?.offsetHeight || 0
    ));

    return { width, height };
}

function applyPreviewZoom() {
    const baseWidth = Math.max(1, previewZoom.baseWidth);
    const baseHeight = Math.max(1, previewZoom.baseHeight);
    const availableWidth = Math.max(1, previewSurface.clientWidth - 32);
    const fitScale = clamp(Math.min(1, availableWidth / baseWidth), MIN_PREVIEW_SCALE, 1);
    previewZoom.fitScale = fitScale;
    previewZoom.scale = clamp(
        previewZoom.manual ? Math.max(previewZoom.scale, fitScale) : fitScale,
        fitScale,
        MAX_PREVIEW_SCALE
    );

    previewFrame.style.width = `${baseWidth}px`;
    previewFrame.style.height = `${baseHeight}px`;
    previewViewport.style.width = `${Math.ceil(baseWidth * previewZoom.scale)}px`;
    previewViewport.style.height = `${Math.ceil(baseHeight * previewZoom.scale)}px`;
    previewViewport.style.transform = 'none';
    previewFrame.style.transform = `scale(${previewZoom.scale.toFixed(4)})`;
}

function updatePreviewSize(frameDocument: Document) {
    const size = measurePreviewSize(frameDocument);
    previewZoom.baseWidth = size.width;
    previewZoom.baseHeight = size.height;
    previewZoom.manual = false;
    applyPreviewZoom();
}

async function renderPreviewNow() {
    const seq = ++renderSeq;
    normalizeEditorMarkdownForRender();
    runCourtCheck();
    const markdown = editor.value.trim() ? editor.value : DEFAULT_MARKDOWN;
    setStatus('組版中...');
    renderButton.disabled = true;
    resetPreviewZoom();

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
        await waitForImages(frameDocument);
        const webFontLoaded = await loadPreviewFonts(frameDocument);
        if (seq !== renderSeq) return;
        if (frameDocument.fonts && frameDocument.fonts.ready) {
            await frameDocument.fonts.ready;
        }
        await nextFrame(frameWindow);
        prepareChromeToc(frameDocument);
        registerPagedTableHandlers(frameWindow);
        await (frameWindow as any).PagedPolyfill.preview();
        fillChromeTocPageNumbers(frameDocument);
        applyManualPageNumbers(frameDocument);
        showPagedOverflow(frameDocument);
        updatePreviewSize(frameDocument);
        setStatus(webFontLoaded ? 'プレビュー更新済み' : 'プレビュー更新済み（Webフォントを読み込めず、端末の明朝体で組みました）');
    } catch (err) {
        console.error(err);
        setStatus(err instanceof Error ? err.message : 'プレビュー作成中にエラーが発生しました。');
    } finally {
        renderButton.disabled = false;
    }
}

function markPreviewDirty() {
    setStatus('未更新');
    scheduleCourtCheck();
}

/**
 * 入力欄の行へ移る（提出前チェックの項目を押したとき）
 */
function selectEditorLine(lineNumber: number) {
    const lines = editor.value.split('\n');
    const index = Math.max(0, Math.min(lines.length, lineNumber) - 1);
    const start = lines.slice(0, index).join('\n').length + (index > 0 ? 1 : 0);
    const end = start + (lines[index] || '').length;
    editor.focus();
    editor.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, index * lineHeight - editor.clientHeight / 3);
}

/**
 * 提出前チェックを走らせ、結果を入力欄とプレビューの間の欄に出す
 */
function runCourtCheck() {
    window.clearTimeout(courtCheckTimer);
    courtCheckIssues = editor.value.trim() ? checkCourtMarkdown(editor.value) : [];
    if (!courtCheckSummary || !courtCheckList) {
        return courtCheckIssues;
    }

    courtCheckList.textContent = '';
    courtCheckSummary.textContent = courtCheckIssues.length === 0
        ? '見つかった問題はありません。'
        : `${courtCheckIssues.length}件の確認事項があります。`;
    courtCheckSummary.closest('.court-check')?.classList.toggle('has-issues', courtCheckIssues.length > 0);

    for (const issue of courtCheckIssues) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'court-check-item';
        if (issue.line) {
            button.dataset.line = String(issue.line);
        } else {
            button.disabled = true;
        }
        const label = document.createElement('span');
        label.className = 'court-check-label';
        label.textContent = getCourtCheckLabel(issue.kind);
        const message = document.createElement('span');
        message.textContent = formatCourtCheckIssue(issue);
        button.append(label, message);
        item.appendChild(button);
        courtCheckList.appendChild(item);
    }
    return courtCheckIssues;
}

function scheduleCourtCheck() {
    window.clearTimeout(courtCheckTimer);
    courtCheckTimer = window.setTimeout(runCourtCheck, 400);
}

function normalizeEditorMarkdownForRender() {
    const original = editor.value;
    const normalized = normalizeEditableMarkdown(original);
    if (normalized === original) {
        return;
    }

    const selectionStart = editor.selectionStart ?? original.length;
    const selectionEnd = editor.selectionEnd ?? original.length;
    const nextSelectionStart = normalizeEditableMarkdown(original.slice(0, selectionStart)).length;
    const nextSelectionEnd = normalizeEditableMarkdown(original.slice(0, selectionEnd)).length;
    editor.value = normalized;
    editor.setSelectionRange(nextSelectionStart, nextSelectionEnd);
}

function getCurrentPdfDocumentTitle() {
    const markdown = editor.value.trim() ? editor.value : DEFAULT_MARKDOWN;
    return buildPdfDocumentTitle(markdown);
}

async function loadTemplate(template: DraftingTemplate) {
    currentMarkdownPath = template.id;
    editor.value = stripTemplateAiNotes(template.content);
    editor.focus();
    editor.setSelectionRange(0, 0);
    renderImageAssetList();
    setStatus(`${template.name} を読み込みました。`);
    await renderPreviewNow();
}

function setupTemplateLoader() {
    if (!templateLoader || !templateSelect) {
        return;
    }

    const templates = getDraftingTemplates();
    if (!templates.length) {
        return;
    }

    appendTemplateOptions(document, templateSelect, templates);

    templateLoader.hidden = false;
    templateSelect.addEventListener('change', () => {
        const selected = templates.find(template => template.id === templateSelect.value);
        if (!selected) {
            editor.focus();
            return;
        }
        loadTemplate(selected).catch(err => {
            console.error(err);
            setStatus('テンプレートの読み込みに失敗しました。');
        });
    });
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

async function loadMarkdownFile(file: File, filePath = file.name) {
    if (!/\.md$/i.test(file.name)) {
        setStatus('.md ファイルを指定してください。');
        return;
    }
    currentMarkdownPath = normalizeLocalPath(filePath || file.name);
    editor.value = await file.text();
    setStatus(`${file.name} を読み込みました。`);
    renderImageAssetList();
    renderPreviewNow();
}

async function handleInputFiles(files: LocalInputFile[]) {
    const markdownFile = files.find(item => /\.md$/i.test(item.path || item.file.name));
    const imageCount = addImageFiles(files);

    if (markdownFile) {
        await loadMarkdownFile(markdownFile.file, markdownFile.path);
        if (imageCount > 0) {
            setStatus(`${markdownFile.file.name} と画像 ${imageCount} 件を読み込みました。`);
        }
        return;
    }

    if (imageCount > 0) {
        setStatus(`画像 ${imageCount} 件を読み込みました。`);
        await renderPreviewNow();
        return;
    }

    setStatus('.md または画像ファイルを指定してください。');
}

async function handleAssetFiles(files: LocalInputFile[]) {
    const imageCount = addImageFiles(files);
    if (imageCount > 0) {
        setStatus(`画像 ${imageCount} 件を読み込みました。`);
        await renderPreviewNow();
        return;
    }
    setStatus('画像ファイルを指定してください。');
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
    collectDroppedFiles(event.dataTransfer).then(handleInputFiles).catch(err => {
        console.error(err);
        setStatus('ファイルの読み込みに失敗しました。');
    });
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
        loadMarkdownFile(file, (file as any).webkitRelativePath || file.name);
    }
});

assetDropZone.addEventListener('dragover', event => {
    event.preventDefault();
    assetDropZone.classList.add('drag-over');
});

assetDropZone.addEventListener('dragleave', () => {
    assetDropZone.classList.remove('drag-over');
});

assetDropZone.addEventListener('drop', event => {
    event.preventDefault();
    assetDropZone.classList.remove('drag-over');
    collectDroppedFiles(event.dataTransfer).then(handleAssetFiles).catch(err => {
        console.error(err);
        setStatus('画像の読み込みに失敗しました。');
    });
});

assetDropZone.addEventListener('click', () => imageFileInput.click());

imageFileButton.addEventListener('click', () => imageFileInput.click());
imageFolderButton.addEventListener('click', () => imageDirectoryInput.click());

imageFileInput.addEventListener('change', () => {
    handleAssetFiles(filesFromFileList(imageFileInput.files)).finally(() => {
        imageFileInput.value = '';
    });
});

imageDirectoryInput.addEventListener('change', () => {
    handleAssetFiles(filesFromFileList(imageDirectoryInput.files)).finally(() => {
        imageDirectoryInput.value = '';
    });
});

imageAssetList.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const button = target.closest('button[data-insert-image-path]') as HTMLButtonElement | null;
    if (!button) {
        return;
    }
    insertAtCursor(`![説明](${button.dataset.insertImagePath || ''})`);
});

pasteButton.addEventListener('click', pasteFromClipboard);

renderButton.addEventListener('click', renderPreviewNow);

htmlPreviewButton.addEventListener('click', openPlainHtmlPreview);

courtCheckList?.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest('button[data-line]') as HTMLButtonElement | null;
    if (button) {
        selectEditorLine(Number(button.dataset.line));
    }
});

/**
 * 印刷の前に提出前チェックをもう一度走らせ、問題があれば印刷してよいかを聞く
 */
function confirmPrintAfterCheck() {
    const issues = runCourtCheck();
    if (issues.length === 0) {
        return true;
    }
    const shown = issues.slice(0, 8).map(issue => `・${formatCourtCheckIssue(issue)}`);
    if (issues.length > shown.length) {
        shown.push(`ほか${issues.length - shown.length}件`);
    }
    return window.confirm(`提出前チェックで${issues.length}件の確認事項が見つかりました。\n\n${shown.join('\n')}\n\nこのまま印刷・PDF保存しますか。`);
}

printButton.addEventListener('click', () => {
    const frameWindow = previewFrame.contentWindow;
    if (!frameWindow) return;
    if (!confirmPrintAfterCheck()) {
        setStatus('印刷を取りやめました。提出前チェックの項目を確かめてください。');
        return;
    }

    const title = getCurrentPdfDocumentTitle();
    const oldTitle = document.title;
    document.title = title;
    if (frameWindow.document) {
        frameWindow.document.title = title;
    }

    const restoreTitle = () => {
        document.title = oldTitle;
        window.removeEventListener('focus', restoreTitle);
    };
    window.addEventListener('focus', restoreTitle, { once: true });
    window.setTimeout(restoreTitle, 30000);

    frameWindow.focus();
    frameWindow.print();
});

window.addEventListener('resize', applyPreviewZoom);

previewSurface.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;

    event.preventDefault();
    previewZoom.manual = true;
    const factor = Math.exp(-event.deltaY * 0.0015);
    previewZoom.scale = clamp(previewZoom.scale * factor, previewZoom.fitScale, MAX_PREVIEW_SCALE);
    applyPreviewZoom();
}, { passive: false });

previewSurface.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;

    previewZoom.startDistance = getTouchDistance(event.touches);
    previewZoom.startScale = previewZoom.scale;
}, { passive: true });

previewSurface.addEventListener('touchmove', event => {
    if (event.touches.length !== 2 || previewZoom.startDistance <= 0) return;

    event.preventDefault();
    previewZoom.manual = true;
    const distance = getTouchDistance(event.touches);
    previewZoom.scale = clamp(previewZoom.startScale * (distance / previewZoom.startDistance), previewZoom.fitScale, MAX_PREVIEW_SCALE);
    applyPreviewZoom();
}, { passive: false });

previewSurface.addEventListener('touchend', () => {
    previewZoom.startDistance = 0;
    previewZoom.startScale = previewZoom.scale;
});

previewSurface.addEventListener('touchcancel', () => {
    previewZoom.startDistance = 0;
    previewZoom.startScale = previewZoom.scale;
});

window.addEventListener('beforeunload', () => {
    for (const asset of imageAssets.values()) {
        URL.revokeObjectURL(asset.url);
    }
});

editor.value = DEFAULT_MARKDOWN;
setupTemplateLoader();
renderImageAssetList();
renderPreviewNow();
