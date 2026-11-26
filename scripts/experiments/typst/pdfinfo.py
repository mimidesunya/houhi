# usage: python -I pdfinfo.py file.pdf [...]
import sys, fitz, os
for p in sys.argv[1:]:
    d = fitz.open(p)
    print('==', os.path.basename(p), 'pages', d.page_count, 'bytes', os.path.getsize(p))
    print('  meta', {k: v for k, v in d.metadata.items() if v})
    fonts = set()
    for i in range(d.page_count):
        for f in d.get_page_fonts(i):
            fonts.add((f[3], f[1], f[2]))
    for f in sorted(fonts):
        print('  font', f)
    # PDF/A marker
    xml = d.get_xml_metadata() or ''
    import re
    m = re.search(r'pdfaid:part[^0-9]*([0-9])', xml)
    c = re.search(r'pdfaid:conformance[^A-Za-z]*([A-Za-z])', xml)
    print('  pdfa', m.group(1) if m else None, c.group(1) if c else None, 'pdfver', d.pdf_trailer()[:0] if False else '')
