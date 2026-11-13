// Decodes the preview picture stored inside old Print Shop Deluxe / Ensemble project files.
// Runs entirely in the browser (or node for testing). No upload, no server.
(function (root) {
  const MAGIC = 'PSDeluxe Preview Bitmap Header';

  function findMagic(b) {
    const m = [...MAGIC].map(c => c.charCodeAt(0));
    outer: for (let i = 0; i <= b.length - m.length; i++) {
      for (let j = 0; j < m.length; j++) if (b[i + j] !== m[j]) continue outer;
      return i;
    }
    return -1;
  }

  // LZSS: flag byte LSB-first (1 = literal); 2-byte big-endian pointer:
  // length = (w >> 13) + 3, position = w & 0x1FFF in an 8 KB zero-filled window starting at 8182.
  function lzss(src, usz) {
    const N = 8192, win = new Uint8Array(N), out = new Uint8Array(usz);
    let r = N - 10, o = 0, i = 0;
    while (o < usz && i < src.length) {
      const flags = src[i++];
      for (let b = 0; b < 8 && o < usz && i < src.length; b++) {
        if ((flags >> b) & 1) {
          const c = src[i++]; out[o++] = c; win[r] = c; r = (r + 1) % N;
        } else {
          if (i + 1 >= src.length) return out.subarray(0, o);
          const w = (src[i] << 8) | src[i + 1]; i += 2;
          const p = w & 0x1fff, len = (w >> 13) + 3;
          for (let k = 0; k < len && o < usz; k++) {
            const c = win[(p + k) % N]; out[o++] = c; win[r] = c; r = (r + 1) % N;
          }
        }
      }
    }
    return out.subarray(0, o);
  }

  // Returns {width, height, rgba: Uint8ClampedArray} or throws Error with a plain message.
  function decode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hdr = String.fromCharCode(...b.subarray(0, 15));
    const at = findMagic(b);
    if (at < 0) throw new Error(hdr === 'PrintShopDeluxe'
      ? 'This Print Shop file has no preview picture inside.'
      : 'This does not look like a Print Shop project file we can read yet.');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const p = at + 30;
    const usz = dv.getUint32(p + 2, true), csz = dv.getUint32(p + 6, true), meth = dv.getUint32(p + 10, true);
    if (meth !== 3 || csz > b.length) throw new Error('Unknown preview type (' + meth + ').');
    const dib = lzss(b.subarray(b.length - csz), usz);
    const d = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    const hsz = d.getUint32(0, true), w = d.getInt32(4, true), hRaw = d.getInt32(8, true), bpp = d.getUint16(14, true);
    const h = Math.abs(hRaw);
    if (![1, 4, 8, 24].includes(bpp) || w <= 0 || w > 4000 || h > 4000) throw new Error('Preview picture is damaged.');
    const ncol = bpp <= 8 ? (d.getUint32(32, true) || (1 << bpp)) : 0;
    const palAt = hsz, pxAt = hsz + 4 * ncol;
    const stride = ((w * bpp + 31) >> 5) << 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const srcRow = hRaw > 0 ? h - 1 - y : y;
      const rowAt = pxAt + srcRow * stride;
      for (let x = 0; x < w; x++) {
        let R, G, B;
        if (bpp === 24) {
          const q = rowAt + x * 3; B = dib[q]; G = dib[q + 1]; R = dib[q + 2];
        } else {
          let idx;
          if (bpp === 8) idx = dib[rowAt + x];
          else if (bpp === 4) idx = (dib[rowAt + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15;
          else idx = (dib[rowAt + (x >> 3)] >> (7 - (x & 7))) & 1;
          const q = palAt + 4 * idx; B = dib[q]; G = dib[q + 1]; R = dib[q + 2];
        }
        const o = (y * w + x) * 4; rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
      }
    }
    return { width: w, height: h, rgba };
  }

  // Print Shop Deluxe 5/6 (.PDS etc.): preview is a complete Windows BMP stored inside the file.
  // Find it by scanning for a 'BM' header whose fields are self-consistent.
  function findBmp(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i + 54 <= b.length; i++) {
      if (b[i] !== 0x42 || b[i + 1] !== 0x4d) continue;
      const size = dv.getUint32(i + 2, true), off = dv.getUint32(i + 10, true);
      const hsz = dv.getUint32(i + 14, true), w = dv.getInt32(i + 18, true), h = dv.getInt32(i + 22, true);
      const planes = dv.getUint16(i + 26, true), bpp = dv.getUint16(i + 28, true), comp = dv.getUint32(i + 30, true);
      if (hsz !== 40 || planes !== 1 || ![1, 4, 8, 24].includes(bpp) || comp > 2) continue;
      if (w <= 0 || w > 4000 || h === 0 || Math.abs(h) > 4000) continue;
      if (size < 54 || i + size > b.length || off < 54 || off >= size) continue;
      return b.subarray(i, i + size);
    }
    return null;
  }

  const api = { decode, findBmp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PSPrev = api;
})(this);
