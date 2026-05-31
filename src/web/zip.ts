type ZipEntryInput = {
    path: string;
    data: Uint8Array;
};

type CentralDirectoryEntry = {
    pathBytes: Uint8Array;
    crc32: number;
    size: number;
    offset: number;
    dosTime: number;
    dosDate: number;
};

const crcTable = (() => {
    const table = new Uint32Array(256);

    for (let i = 0; i < table.length; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }

    return table;
})();

function crc32(data: Uint8Array) {
    let crc = 0xffffffff;

    for (const byte of data) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date: Date) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
}

function writeUint16(view: DataView, offset: number, value: number) {
    view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
    view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }

    return output;
}

function makeLocalHeader(entry: CentralDirectoryEntry) {
    const header = new Uint8Array(30 + entry.pathBytes.length);
    const view = new DataView(header.buffer);

    writeUint32(view, 0, 0x04034b50);
    writeUint16(view, 4, 20);
    writeUint16(view, 6, 0x0800);
    writeUint16(view, 8, 0);
    writeUint16(view, 10, entry.dosTime);
    writeUint16(view, 12, entry.dosDate);
    writeUint32(view, 14, entry.crc32);
    writeUint32(view, 18, entry.size);
    writeUint32(view, 22, entry.size);
    writeUint16(view, 26, entry.pathBytes.length);
    writeUint16(view, 28, 0);
    header.set(entry.pathBytes, 30);

    return header;
}

function makeCentralHeader(entry: CentralDirectoryEntry) {
    const header = new Uint8Array(46 + entry.pathBytes.length);
    const view = new DataView(header.buffer);

    writeUint32(view, 0, 0x02014b50);
    writeUint16(view, 4, 20);
    writeUint16(view, 6, 20);
    writeUint16(view, 8, 0x0800);
    writeUint16(view, 10, 0);
    writeUint16(view, 12, entry.dosTime);
    writeUint16(view, 14, entry.dosDate);
    writeUint32(view, 16, entry.crc32);
    writeUint32(view, 20, entry.size);
    writeUint32(view, 24, entry.size);
    writeUint16(view, 28, entry.pathBytes.length);
    writeUint16(view, 30, 0);
    writeUint16(view, 32, 0);
    writeUint16(view, 34, 0);
    writeUint16(view, 36, 0);
    writeUint32(view, 38, 0);
    writeUint32(view, 42, entry.offset);
    header.set(entry.pathBytes, 46);

    return header;
}

function makeEndRecord(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);

    writeUint32(view, 0, 0x06054b50);
    writeUint16(view, 4, 0);
    writeUint16(view, 6, 0);
    writeUint16(view, 8, entryCount);
    writeUint16(view, 10, entryCount);
    writeUint32(view, 12, centralDirectorySize);
    writeUint32(view, 16, centralDirectoryOffset);
    writeUint16(view, 20, 0);

    return record;
}

export function buildStoredZip(entries: ZipEntryInput[]) {
    const encoder = new TextEncoder();
    const now = new Date();
    const { dosTime, dosDate } = getDosDateTime(now);
    const fileParts: Uint8Array[] = [];
    const centralEntries: CentralDirectoryEntry[] = [];
    let offset = 0;

    for (const input of entries) {
        const pathBytes = encoder.encode(input.path);
        const entry = {
            pathBytes,
            crc32: crc32(input.data),
            size: input.data.length,
            offset,
            dosTime,
            dosDate,
        };
        const header = makeLocalHeader(entry);

        fileParts.push(header, input.data);
        centralEntries.push(entry);
        offset += header.length + input.data.length;
    }

    const centralOffset = offset;
    const centralParts = centralEntries.map(makeCentralHeader);
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const endRecord = makeEndRecord(entries.length, centralSize, centralOffset);

    return concat([...fileParts, ...centralParts, endRecord]);
}
