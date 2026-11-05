import { ATTACHMENT_IMAGE_MAX_BYTES } from '@spark-outpost/contracts';

export const SCREENSHOT_FALLBACK =
  'Screen capture is not available here. Take a screenshot with ⌘⇧4 and paste it with ⌘V.';

export function canCaptureScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

async function firstFrame(stream: MediaStream): Promise<HTMLCanvasElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  if (video.videoWidth === 0) {
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')?.drawImage(video, 0, 0);
  video.srcObject = null;
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the screenshot.'))),
      type,
      0.9,
    );
  });
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

export async function captureScreenshot(): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  let canvas: HTMLCanvasElement;
  try {
    canvas = await firstFrame(stream);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
  const png = await encode(canvas, 'image/png');
  if (png.size <= ATTACHMENT_IMAGE_MAX_BYTES) {
    return new File([png], `screenshot-${timestamp()}.png`, { type: 'image/png' });
  }
  const jpeg = await encode(canvas, 'image/jpeg');
  return new File([jpeg], `screenshot-${timestamp()}.jpg`, { type: 'image/jpeg' });
}
