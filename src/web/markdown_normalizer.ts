export function normalizeEditableMarkdown(markdown: string) {
    return String(markdown || '')
        .split(/(\r?\n)/)
        .map(part => {
            if (/^\r?\n$/.test(part)) {
                return part;
            }

            const match = part.match(/^([ \t]*)(#{3,})([ \t]*)(.*)$/);
            if (!match) {
                return part;
            }

            const [, indent, _hashes, space, text] = match;
            if (text.startsWith('-')) {
                return part;
            }

            return `${indent}##${space}${text}`;
        })
        .join('');
}
