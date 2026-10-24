import {jpegWithoutGps} from './strip-gps';

/**
 * Minimal little-endian JPEG: SOI, APP1 Exif (IFD0 with one GPSInfo entry pointing to a
 * GPS IFD with a GPSLatitude of 3 rationals), optional APP1 XMP, then SOS and EOI.
 */
function makeJpeg(withXmp = false): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  // header: II, 42, IFD0 at 8
  tiff.push(0x49, 0x49);
  u16(42);
  u32(8);
  // IFD0 (offset 8): 1 entry, GPSInfo -> GPS IFD at 26
  u16(1);
  u16(0x8825); u16(4); u32(1); u32(26);
  u32(0); // next IFD
  // GPS IFD (offset 26): 1 entry GPSLatitude, RATIONAL x3 -> values at 44
  u16(1);
  u16(0x0002); u16(5); u32(3); u32(44);
  u32(0);
  // values (offset 44): 43/1, 36/1, 1234/100
  [43, 1, 36, 1, 1234, 100].forEach(u32);

  const exif = [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat(tiff);
  const app1 = [0xFF, 0xE1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif];
  const xmpBody = [...'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS</x:xmpmeta>'].map(c => c.charCodeAt(0));
  const xmp = [0xFF, 0xE1, ((xmpBody.length + 2) >> 8) & 0xff, (xmpBody.length + 2) & 0xff, ...xmpBody];
  const sos = [0xFF, 0xDA, 0x00, 0x02, 0x11, 0x22, 0xFF, 0xD9];
  return new Uint8Array([0xFF, 0xD8, ...app1, ...(withXmp ? xmp : []), ...sos]);
}

describe('jpegWithoutGps', () => {
  const tiffStart = 2 + 4 + 6; // SOI + APP1 header + 'Exif\0\0'

  it('should remove the GPS entry and zero its values', () => {
    const jpeg = makeJpeg();
    const out = jpegWithoutGps(jpeg.slice().buffer) as Uint8Array;
    expect(out instanceof Uint8Array).toBe(true);
    expect(out.length).toBe(jpeg.length);
    const d = new DataView(out.buffer, out.byteOffset + tiffStart);
    // IFD0 has no entry left
    expect(d.getUint16(8, true)).toBe(0);
    // latitude values erased
    for (let i = 44; i < 44 + 24; i++) {
      expect(out[tiffStart + i]).toBe(0);
    }
    // image data untouched
    expect(Array.from(out.slice(-8))).toEqual([0xFF, 0xDA, 0x00, 0x02, 0x11, 0x22, 0xFF, 0xD9]);
  });

  it('should drop the XMP segment', async () => {
    const jpeg = makeJpeg(true);
    const out = jpegWithoutGps(jpeg.slice().buffer);
    expect(out instanceof Blob).toBe(true);
    const bytes = new Uint8Array(await (out as Blob).arrayBuffer());
    const text = String.fromCharCode(...Array.from(bytes));
    expect(text.includes('xmpmeta')).toBe(false);
    expect(text.includes('Exif')).toBe(true);
  });

  it('should refuse a non JPEG file', () => {
    expect(jpegWithoutGps(new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer)).toBeNull();
  });
});
