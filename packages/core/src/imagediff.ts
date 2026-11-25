import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface DiffOutcome {
  diffPixels: number;
  ratio: number;
  width: number;
  height: number;
  sizeChanged: boolean;
  diffPng: Buffer;
}

function padded(src: PNG, width: number, height: number, fill: [number, number, number]): Uint8Array {
  const out = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    out.data[i * 4] = fill[0];
    out.data[i * 4 + 1] = fill[1];
    out.data[i * 4 + 2] = fill[2];
    out.data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < src.height; y++) {
    src.data.copy(out.data, y * width * 4, y * src.width * 4, (y + 1) * src.width * 4);
  }
  return out.data;
}

/**
 * Pixel diff of two PNGs. When sizes differ both are padded to the larger canvas
 * with different colors, so the extra area counts as changed.
 */
export function diffPngs(a: Buffer, b: Buffer, opts: { threshold: number; ignoreAntialiasing: boolean }): DiffOutcome {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);
  const sizeChanged = imgA.width !== imgB.width || imgA.height !== imgB.height;
  const dataA = sizeChanged ? padded(imgA, width, height, [255, 0, 255]) : imgA.data;
  const dataB = sizeChanged ? padded(imgB, width, height, [0, 255, 255]) : imgB.data;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(dataA, dataB, diff.data, width, height, {
    threshold: opts.threshold,
    includeAA: !opts.ignoreAntialiasing,
  });
  return {
    diffPixels,
    ratio: width * height === 0 ? 0 : diffPixels / (width * height),
    width,
    height,
    sizeChanged,
    diffPng: PNG.sync.write(diff),
  };
}
