import { REMOTE_SPARK_ICON_MAX_BYTES, REMOTE_SPARK_ICON_TYPES } from '@spark-outpost/contracts';
import { ICON_PROBLEM } from './remote-sparks-copy.ts';
import { drawSquarePng } from './spark-icon-canvas.ts';

export const SPARK_ICON_ACCEPT = REMOTE_SPARK_ICON_TYPES.join(',');

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(ICON_PROBLEM));
    reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ''));
    reader.readAsDataURL(blob);
  });
}

export async function sparkIconPng(
  file: Blob,
  draw: (file: Blob) => Promise<Blob> = drawSquarePng,
): Promise<string> {
  if (!REMOTE_SPARK_ICON_TYPES.some((type) => type === file.type)) throw new Error(ICON_PROBLEM);
  let png: Blob;
  try {
    png = await draw(file);
  } catch {
    throw new Error(ICON_PROBLEM);
  }
  if (png.size === 0 || png.size > REMOTE_SPARK_ICON_MAX_BYTES) throw new Error(ICON_PROBLEM);
  return base64Of(png);
}
