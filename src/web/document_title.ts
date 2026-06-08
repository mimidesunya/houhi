const DEFAULT_PDF_DOCUMENT_TITLE = '法匪 PDF';

export function extractMarkdownDocumentTitle(markdown: string) {
    let inFence = false;
    let fenceMarker = '';

    for (const rawLine of String(markdown || '').split(/\r?\n/)) {
        const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[1][0];
            if (!inFence) {
                inFence = true;
                fenceMarker = marker;
                continue;
            }
            if (marker === fenceMarker) {
                inFence = false;
                fenceMarker = '';
                continue;
            }
        }

        if (inFence) {
            continue;
        }

        const titleMatch = rawLine.match(/^#\s+(.+?)\s*$/);
        if (!titleMatch) {
            continue;
        }

        return titleMatch[1].replace(/\s+#+\s*$/, '').trim();
    }

    return '';
}

export function sanitizeDownloadTitle(value: string, fallback = DEFAULT_PDF_DOCUMENT_TITLE) {
    const sanitized = String(value || '')
        .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.\s]+$/g, '')
        .slice(0, 120)
        .trim();

    return sanitized || fallback;
}

export function buildPdfDocumentTitle(markdown: string) {
    return sanitizeDownloadTitle(extractMarkdownDocumentTitle(markdown));
}
