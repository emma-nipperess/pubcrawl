// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, safeFileName, ZipWriter } from '@/lib/zip';

const enc = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

function hasUnzip() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('zip writer', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes a valid archive with unique, safe names', async () => {
    const z = new ZipWriter();
    expect(z.add('Team A - photo.jpg', enc('one'))).toBe('Team A - photo.jpg');
    expect(z.add('Team A - photo.jpg', enc('two'))).toBe('Team A - photo (2).jpg');
    z.add('Ünïcødé 🎃.mp4', enc('three'));
    const buf = new Uint8Array(await z.toBlob().arrayBuffer());
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const eocd = buf.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(3);
    if (hasUnzip()) {
      const dir = mkdtempSync(join(tmpdir(), 'zip-'));
      try {
        writeFileSync(join(dir, 'a.zip'), buf);
        execFileSync('unzip', ['-qq', '-t', join(dir, 'a.zip')], { timeout: 10_000 });
        expect(execFileSync('unzip', ['-p', join(dir, 'a.zip'), 'Team A - photo (2).jpg'], { timeout: 10_000 }).toString()).toBe('two');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('sanitises file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeFileName('a<b>:c"d|e?f*g\\h/i')).toBe('a-b-c-d-e-f-g-h-i');
    expect(safeFileName('   ')).toBe('file');
    expect(safeFileName('x'.repeat(300)).length).toBe(120);
  });

});
