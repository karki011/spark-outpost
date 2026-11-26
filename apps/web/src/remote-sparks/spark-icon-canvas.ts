import { REMOTE_SPARK_ICON_SIZE } from '@spark-outpost/contracts';

export async function drawSquarePng(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = REMOTE_SPARK_ICON_SIZE;
    canvas.height = REMOTE_SPARK_ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context || side === 0) throw new Error('The image could not be drawn.');
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      REMOTE_SPARK_ICON_SIZE,
      REMOTE_SPARK_ICON_SIZE,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('The image could not be saved.'))),
        'image/png',
      );
    });
  } finally {
    bitmap.close();
  }
}
