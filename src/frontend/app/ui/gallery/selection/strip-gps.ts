/**
 * Removes the location of a JPEG without re-encoding it: the GPSInfo entry (0x8825) is
 * taken out of IFD0 and the GPS IFD (with its values) is zeroed; XMP segments
 * (APP1 Adobe, which can repeat the location) are dropped.
 * Returns null if the file does not have the expected shape (the caller re-encodes it then).
 */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

const startsWith = (u: Uint8Array, p: number, text: string): boolean =>
  [...text].every((ch, i) => u[p + i] === ch.charCodeAt(0));

function eraseGps(u: Uint8Array, tiffStart: number, length: number): void {
  const d = new DataView(u.buffer, u.byteOffset + tiffStart, length);
  const le = d.getUint16(0) === 0x4949;
  const g16 = (o: number) => d.getUint16(o, le);
  const g32 = (o: number) => d.getUint32(o, le);
  const zero = (o: number, l: number) => {
    if (o < 0 || o + l > length) {
      throw new RangeError('EXIF');
    }
    u.fill(0, tiffStart + o, tiffStart + o + l);
  };
  const ifd0 = g32(4);
  const n = g16(ifd0);
  const end = ifd0 + 2 + 12 * n + 4;
  if (end > length) {
    throw new RangeError('EXIF');
  }
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + 12 * i;
    if (g16(e) !== 0x8825) {
      continue;
    }
    const gps = g32(e + 8);
    const gn = g16(gps);
    for (let j = 0; j < gn; j++) {
      const f = gps + 2 + 12 * j;
      const l = (TYPE_SIZES[g16(f + 2)] || 1) * g32(f + 4);
      if (l > 4) {
        zero(g32(f + 8), l);
      }
    }
    zero(gps, 2 + 12 * gn + 4);
    // remove the entry and move back the next-IFD pointer
    u.copyWithin(tiffStart + e, tiffStart + e + 12, tiffStart + end);
    u.fill(0, tiffStart + end - 12, tiffStart + end);
    d.setUint16(ifd0, n - 1, le);
    return;
  }
}

export function jpegWithoutGps(buffer: ArrayBuffer): Uint8Array | Blob | null {
  const u = new Uint8Array(buffer);
  if (u[0] !== 0xFF || u[1] !== 0xD8) {
    return null;
  }
  const remove: [number, number][] = [];
  let p = 2;
  try {
    while (p + 4 <= u.length) {
      if (u[p] !== 0xFF) {
        return null;
      }
      const marker = u[p + 1];
      if (marker === 0xFF) {
        p++;
        continue;
      }
      if (marker === 0xDA || marker === 0xD9) {
        break; // image data: no more metadata
      }
      const l = (u[p + 2] << 8) | u[p + 3];
      if (marker === 0xE1 && startsWith(u, p + 4, 'Exif\0\0')) {
        eraseGps(u, p + 10, l - 8);
      } else if (marker === 0xE1 && startsWith(u, p + 4, 'http://ns.adobe.com/')) {
        remove.push([p, p + 2 + l]);
      }
      p += 2 + l;
    }
  } catch (e) {
    return null;
  }
  if (!remove.length) {
    return u;
  }
  const parts: Uint8Array[] = [];
  let a = 0;
  for (const [x, y] of remove) {
    parts.push(u.subarray(a, x));
    a = y;
  }
  parts.push(u.subarray(a));
  return new Blob(parts);
}

/**
 * Re-encodes an image to JPEG in the browser (orientation applied, no metadata at all).
 * Longer side capped to 4096 px (canvas limit on iPhones).
 */
export async function toJpeg(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise<Blob>((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    if (!b) {
      throw new Error('JPEG re-encoding failed');
    }
    return b;
  } finally {
    URL.revokeObjectURL(url);
  }
}
