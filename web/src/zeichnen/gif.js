// Animated GIFs on the canvas. An <img> only ever paints the first frame
// onto a canvas; here the file itself is decoded and placed frame by frame
// onto a separate canvas, which the board then draws instead of the <img>.
//
// The frames are only unpacked during playback, not all in advance: a GIF
// with 100 frames at 500 x 500 would otherwise take up 100 MB.

import { decompressFrame, parseGIF } from 'gifuct-js';

/** Is this a GIF file? (magic bytes "GIF8") */
export function istGif(puffer) {
  const b = new Uint8Array(puffer, 0, Math.min(4, puffer.byteLength));
  return b.length === 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
}

// Browsers show delays that are too short (0 or 10 ms) as 100 ms
function verzoegerung(ms) {
  return !ms || ms < 20 ? 100 : ms;
}

export class GifAnimation {
  /** null if the file is not a GIF with several frames */
  static aus(puffer) {
    if (!istGif(puffer)) return null;
    try {
      const gif = parseGIF(puffer);
      const bilder = gif.frames.filter((f) => f.image);
      if (bilder.length < 2) return null;
      return new GifAnimation(gif, bilder);
    } catch {
      return null;
    }
  }

  constructor(gif, bilder) {
    this.gif = gif;
    this.bilder = bilder;
    this.canvas = document.createElement('canvas');
    this.canvas.width = gif.lsd.width;
    this.canvas.height = gif.lsd.height;
    this.ctx = this.canvas.getContext('2d');
    this.stueck = document.createElement('canvas');
    this.stueckCtx = this.stueck.getContext('2d');
    this.index = -1;
    this.vorher = null; // { dims, disposalType, sicherung }
    this.faellig = 0;
    this.#weiter();
  }

  /** Next frame, if due. true if the frame has changed. */
  schritt(jetzt) {
    if (jetzt < this.faellig) return false;
    // Do not catch up: if the GIF was out of view, it continues from there
    this.#weiter();
    return true;
  }

  /** ms until the next frame */
  get bisNaechstes() {
    return Math.max(0, this.faellig - performance.now());
  }

  #weiter() {
    const { ctx } = this;
    this.index = (this.index + 1) % this.bilder.length;
    if (this.index === 0) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.vorher = null;
    }
    // What the previous frame requested for its disposal
    const v = this.vorher;
    if (v?.disposalType === 2) {
      ctx.clearRect(v.dims.left, v.dims.top, v.dims.width, v.dims.height);
    } else if (v?.disposalType === 3 && v.sicherung) {
      ctx.putImageData(v.sicherung, 0, 0);
    }
    const bild = decompressFrame(this.bilder[this.index], this.gif.gct, true);
    const { dims } = bild;
    const sicherung = bild.disposalType === 3
      ? ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
      : null;
    if (dims.width > 0 && dims.height > 0) {
      // Via a helper canvas, so transparent pixels do not overwrite
      if (this.stueck.width !== dims.width || this.stueck.height !== dims.height) {
        this.stueck.width = dims.width;
        this.stueck.height = dims.height;
      }
      this.stueckCtx.putImageData(new ImageData(bild.patch, dims.width, dims.height), 0, 0);
      ctx.drawImage(this.stueck, dims.left, dims.top);
    }
    this.vorher = { dims, disposalType: bild.disposalType, sicherung };
    this.dauer = verzoegerung(bild.delay);
    this.faellig = performance.now() + this.dauer;
  }
}
