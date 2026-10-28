/**
 * Minimal ZIP writer (STORE, no compression — photos and videos are already
 * compressed, so deflating them only burns battery). Produces a standard
 * PKZIP archive readable by Files (iOS), Android, macOS, Windows and unzip.
 * Limits: < 4 GB total and < 65 535 entries (no ZIP64).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export const ZIP_MAX_BYTES = 0xffffffff - 1024 * 1024;

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Make a name safe for every OS: no path separators, control or reserved characters. */
export function safeFileName(name: string, maxLen = 120): string {
  const cleaned = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .trim();
  return (cleaned || 'file').slice(0, maxLen);
}

export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array<ArrayBuffer>[] = [];
  private offset = 0;
  private count = 0;
  private names = new Set<string>();
  private enc = new TextEncoder();

  /** Ensure unique names inside the archive ("a.jpg", "a (2).jpg"…). */
  private unique(name: string): string {
    let n = name;
    let i = 2;
    while (this.names.has(n.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      n = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
      i++;
    }
    this.names.add(n.toLowerCase());
    return n;
  }

  get size() {
    return this.offset;
  }

  add(name: string, data: Uint8Array<ArrayBuffer>, modified = new Date()): string {
    if (this.count >= 65535) throw new Error('Too many files for one zip');
    if (this.offset + data.length + 1024 > ZIP_MAX_BYTES) throw new Error('Zip would exceed 4 GB');
    const finalName = this.unique(name);
    const nameBytes = this.enc.encode(finalName);
    const crc = crc32(data);
    const { time, date } = dosDateTime(modified);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, 0, true);
    cen.setUint16(32, 0, true);
    cen.setUint16(34, 0, true);
    cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true);
    cen.setUint32(42, this.offset, true);

    this.parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const c = new Uint8Array(46 + nameBytes.length);
    c.set(new Uint8Array(cen.buffer), 0);
    c.set(nameBytes, 46);
    this.central.push(c);
    this.offset += 30 + nameBytes.length + data.length;
    this.count++;
    return finalName;
  }

  /** Finish the archive. */
  toBlob(): Blob {
    const cenSize = this.central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, this.offset, true);
    end.setUint16(20, 0, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
}
