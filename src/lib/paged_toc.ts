export function prepareChromeToc(root: Document = document) {
    const tocRoots = Array.prototype.slice.call(root.querySelectorAll('[data-houhi-chrome-toc]')) as HTMLElement[];
    if (tocRoots.length === 0) return;

    const headings = Array.prototype.slice.call(root.querySelectorAll('h1, h2')) as HTMLElement[];
    const targetHeadings = headings.filter(heading => !heading.closest('[data-houhi-chrome-toc]'));

    targetHeadings.forEach((heading, index) => {
        if (!heading.getAttribute('data-houhi-toc-id')) {
            heading.setAttribute('data-houhi-toc-id', `houhi-toc-${index + 1}`);
        }
    });

    tocRoots.forEach(tocRoot => {
        tocRoot.innerHTML = '';
        tocRoot.setAttribute('data-houhi-chrome-toc', 'ready');
        let currentLevel1Item: HTMLLIElement | null = null;

        targetHeadings.forEach(heading => {
            const isLevel2 = heading.tagName.toLowerCase() === 'h2';
            const li = root.createElement('li');
            li.setAttribute('data-houhi-toc-target', heading.getAttribute('data-houhi-toc-id') || '');

            const link = root.createElement('a');
            const title = root.createElement('span');
            title.className = 'cssj-title';
            title.textContent = (heading.textContent || '').trim();

            const page = root.createElement('span');
            page.className = 'cssj-page';
            page.textContent = ' ';

            const leader = root.createElement('span');
            leader.className = 'cssj-leader';

            link.appendChild(title);
            link.appendChild(leader);
            link.appendChild(page);
            li.appendChild(link);

            if (isLevel2 && currentLevel1Item) {
                let nested = currentLevel1Item.querySelector(':scope > ul');
                if (!nested) {
                    nested = root.createElement('ul');
                    currentLevel1Item.appendChild(nested);
                }
                nested.appendChild(li);
            } else {
                tocRoot.appendChild(li);
                currentLevel1Item = isLevel2 ? null : li;
            }
        });
    });
}

function cssEscape(value: string) {
    const cssApi = (globalThis as any).CSS;
    if (cssApi && typeof cssApi.escape === 'function') {
        return cssApi.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
}

function findPagedCloneForSource(root: Document, source: Element | null) {
    const ref = source && source.getAttribute('data-ref');
    if (ref) {
        const clone = root.querySelector(`.pagedjs_pages [data-ref="${cssEscape(ref)}"]`);
        if (clone) return clone;
    }

    const tocId = source && source.getAttribute('data-houhi-toc-id');
    if (tocId) {
        return root.querySelector(`.pagedjs_pages [data-houhi-toc-id="${cssEscape(tocId)}"]`);
    }

    return null;
}

function getPageNumberForElement(element: Element | null) {
    const page = element && element.closest('.pagedjs_page') as HTMLElement | null;
    if (!page) return '';
    return page.getAttribute('data-page-number') || page.dataset.pageNumber || '';
}

export function fillChromeTocPageNumbers(root: Document = document) {
    const sourceById: Record<string, Element> = {};
    Array.prototype.forEach.call(root.querySelectorAll('h1[data-houhi-toc-id], h2[data-houhi-toc-id]'), (heading: Element) => {
        sourceById[heading.getAttribute('data-houhi-toc-id') || ''] = heading;
    });

    Array.prototype.forEach.call(root.querySelectorAll('.pagedjs_pages [data-houhi-chrome-toc] li[data-houhi-toc-target]'), (item: Element) => {
        const targetId = item.getAttribute('data-houhi-toc-target') || '';
        const source = sourceById[targetId];
        const clone = findPagedCloneForSource(root, source);
        const pageNumber = getPageNumberForElement(clone);
        const pageSpan = item.querySelector('.cssj-page');
        if (pageSpan && pageNumber) {
            pageSpan.textContent = pageNumber;
        }
    });
}

export function applyManualPageNumbers(root: Document = document) {
    const pageNumberStyle = root.createElement('style');
    pageNumberStyle.setAttribute('data-houhi-pagedjs-page-numbers', 'manual');
    pageNumberStyle.textContent = 'html[data-houhi-pdf-engine="chrome"] body::before { content: none !important; display: none !important; } @page { @bottom-center { content: none; } } .pagedjs_pages .pagedjs_margin-bottom .pagedjs_margin-bottom-center .pagedjs_margin-content::after { content: none !important; }';
    root.head.appendChild(pageNumberStyle);

    Array.prototype.forEach.call(root.querySelectorAll('.pagedjs_page'), (page: HTMLElement, index: number) => {
        const footer = page.querySelector('.pagedjs_margin-bottom-center .pagedjs_margin-content');
        if (footer) {
            if (footer.parentElement) {
                footer.parentElement.classList.add('hasContent');
            }
            footer.textContent = `- ${index + 1} -`;
        }
    });
}

export function getPagedTocBrowserScript() {
    return `
var cssEscape = ${cssEscape.toString()};
var findPagedCloneForSource = ${findPagedCloneForSource.toString()};
var getPageNumberForElement = ${getPageNumberForElement.toString()};
function prepareChromeToc(){(${prepareChromeToc.toString()})(document);}
function fillChromeTocPageNumbers(){(${fillChromeTocPageNumbers.toString()})(document);}
function applyManualPageNumbers(){(${applyManualPageNumbers.toString()})(document);}
`.trim();
}
