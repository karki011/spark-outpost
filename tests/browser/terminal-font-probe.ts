import { expect, type Locator, type Page } from '@playwright/test';

const TABLE_WIDTH = 240;
export const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export interface FontProbe {
  faces: string[];
  regular: boolean;
  bold: boolean;
  boldFace: boolean;
  regularWidth: number;
  boldWidth: number;
}

export function probeFonts(page: Page, family: string): Promise<FontProbe> {
  return page.evaluate(async (wanted) => {
    const SAMPLE = 'Rg@agQ0O1lI{}';
    const raster = (font: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 40;
      const context = canvas.getContext('2d')!;
      context.font = font;
      context.textBaseline = 'top';
      context.fillText(SAMPLE, 2, 6);
      return {
        pixels: context.getImageData(0, 0, 240, 40).data.join(','),
        width: context.measureText(SAMPLE).width,
      };
    };
    const name = wanted.split(',')[0]!.trim().replace(/["']/g, '');
    await Promise.allSettled([
      document.fonts.load(`24px "${name}"`, SAMPLE),
      document.fonts.load(`bold 24px "${name}"`, SAMPLE),
    ]);
    const faces = [...document.fonts].filter(
      (face) => face.family.replace(/["']/g, '') === name && face.status === 'loaded',
    );
    const covers = (face: FontFace, weight: number) => {
      const range = face.weight
        .split(' ')
        .map((part) => (part === 'normal' ? 400 : part === 'bold' ? 700 : Number(part)));
      return range[0]! <= weight && weight <= (range[1] ?? range[0]!);
    };
    const fallback = wanted.split(',').slice(1).join(',');
    const regular = raster(`24px ${wanted}`);
    const bold = raster(`bold 24px ${wanted}`);
    return {
      faces: faces.map((face) => `${face.weight} ${face.unicodeRange.slice(0, 24)}`),
      regular: regular.pixels !== raster(`24px ${fallback}`).pixels,
      bold: bold.pixels !== raster(`bold 24px ${fallback}`).pixels,
      boldFace: faces.some((face) => covers(face, 700)),
      regularWidth: regular.width,
      boldWidth: bold.width,
    };
  }, family);
}

export interface StackProbe {
  regularLikeReference: boolean;
  boldLikeReference: boolean;
  inked: boolean;
  regularWidth: number;
  boldWidth: number;
}

export function probeStack(page: Page, stack: string, reference: string): Promise<StackProbe> {
  return page.evaluate(
    ({ stack, reference }) => {
      const SAMPLE = 'Rg@agQ0O1lI{}';
      const raster = (font: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 40;
        const context = canvas.getContext('2d')!;
        context.font = font;
        context.textBaseline = 'top';
        context.fillText(SAMPLE, 2, 6);
        const pixels = context.getImageData(0, 0, 240, 40).data;
        return {
          pixels: pixels.join(','),
          inked: pixels.some((value, index) => index % 4 === 3 && value > 0),
          width: context.measureText(SAMPLE).width,
        };
      };
      const regular = raster(`24px ${stack}`);
      const bold = raster(`bold 24px ${stack}`);
      return {
        regularLikeReference: regular.pixels === raster(`24px ${reference}`).pixels,
        boldLikeReference: bold.pixels === raster(`bold 24px ${reference}`).pixels,
        inked: regular.inked && bold.inked,
        regularWidth: regular.width,
        boldWidth: bold.width,
      };
    },
    { stack, reference },
  );
}

export async function tableShot(page: Page, workspace: Locator): Promise<Buffer> {
  const [top, bottom, rows] = await workspace
    .locator('.xterm-accessibility-tree > div')
    .evaluateAll((lines) => [
      lines.findIndex((line) => line.textContent?.includes('┌')),
      lines.findIndex((line) => line.textContent?.includes('└')),
      lines.length,
    ]);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeGreaterThan(top!);
  const screen = (await workspace.locator('.xterm-screen').boundingBox())!;
  const row = screen.height / rows!;
  return page.screenshot({
    clip: {
      x: screen.x,
      y: screen.y + top! * row,
      width: TABLE_WIDTH,
      height: (bottom! - top! + 1) * row,
    },
  });
}
