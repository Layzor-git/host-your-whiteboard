// Animierte GIFs auf der Leinwand. Ein <img> malt auf ein Canvas immer nur
// das erste Bild; hier wird die Datei selbst zerlegt und Bild fuer Bild auf
// ein eigenes Canvas gesetzt, das die Leinwand dann statt des <img> zeichnet.
//
// Die Einzelbilder werden erst beim Abspielen entpackt, nicht alle vorab:
// Ein GIF mit 100 Bildern in 500 x 500 wuerde sonst 100 MB belegen.

import { decompressFrame, parseGIF } from 'gifuct-js';

/** Ist das eine GIF-Datei? (Magische Bytes "GIF8") */
export function istGif(puffer) {
  const b = new Uint8Array(puffer, 0, Math.min(4, puffer.byteLength));
  return b.length === 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
}

// Browser zeigen zu kurze Verzoegerungen (0 oder 10 ms) mit 100 ms an
function verzoegerung(ms) {
  return !ms || ms < 20 ? 100 : ms;
}

export class GifAnimation {
  /** null, wenn die Datei kein GIF mit mehreren Bildern ist */
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

  /** Naechstes Bild, falls faellig. true, wenn sich das Bild geaendert hat. */
  schritt(jetzt) {
    if (jetzt < this.faellig) return false;
    // Nicht aufholen: Lag das GIF ausserhalb der Sicht, geht es dort weiter
    this.#weiter();
    return true;
  }

  /** ms bis zum naechsten Bild */
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
    // Was das vorige Bild ueber sein Entfernen verlangt hat
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
      // Ueber ein Hilfscanvas, damit transparente Pixel nicht ueberschreiben
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
