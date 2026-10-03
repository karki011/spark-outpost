import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from '../../web/src/brand/scout-shape.ts';
import { desktopDir } from './stage.ts';

const run = promisify(execFile);

const BODY = '#2bb39a';
const SPARK = '#f2b54a';
const INK = '#0c0f12';
const EYES = `<rect x="22.5" y="32" width="5.6" height="11" rx="2.8"/><rect x="35.9" y="32" width="5.6" height="11" rx="2.8"/>`;

function scout(): string {
  return [
    `<path d="${SCOUT_ANTENNA}" fill="none" stroke="${BODY}" stroke-width="3.6" stroke-linecap="round"/>`,
    `<path d="${SCOUT_SPARK}" fill="${SPARK}"/>`,
    `<path d="${SCOUT_BODY}" fill="${BODY}"/>`,
    `<g fill="${INK}">${EYES}</g>`,
  ].join('');
}

const DEV_BADGE = [
  `<rect x="548" y="728" width="320" height="140" rx="70" fill="#e8613c"/>`,
  `<rect x="548" y="728" width="320" height="140" rx="70" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="10"/>`,
  `<text x="708" y="830" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="96" font-weight="800" letter-spacing="4" fill="#ffffff">DEV</text>`,
].join('');

function appIconSvg(dev: boolean): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g filter="url(#shadow)"><g transform="translate(78 70) scale(13.5)">${scout()}</g></g>
  ${dev ? DEV_BADGE : ''}
</svg>`;
}

function trayTemplateSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="4 0 56 58">
  <defs>
    <mask id="face">
      <rect x="0" y="0" width="64" height="64" fill="#ffffff"/>
      <g fill="#000000">${EYES}</g>
    </mask>
  </defs>
  <g mask="url(#face)">
    <path d="${SCOUT_ANTENNA}" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round"/>
    <path d="${SCOUT_SPARK}" fill="#000000"/>
    <path d="${SCOUT_BODY}" fill="#000000"/>
  </g>
</svg>`;
}

const ICONSET_SIZES = [16, 32, 128, 256, 512];

async function png(svg: string, size: number, file: string): Promise<void> {
  const intrinsic = Number(/width="(\d+)"/.exec(svg)?.[1] ?? size);
  await sharp(Buffer.from(svg), { density: Math.min(2400, (72 * size * 2) / intrinsic) })
    .resize(size, size)
    .png()
    .toFile(file);
}

async function icns(svg: string, file: string): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), 'spark-icon-'));
  const iconset = path.join(work, 'icon.iconset');
  await mkdir(iconset);
  for (const size of ICONSET_SIZES) {
    await png(svg, size, path.join(iconset, `icon_${size}x${size}.png`));
    await png(svg, size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  await run('iconutil', ['--convert', 'icns', '--output', file, iconset]);
  await rm(work, { recursive: true, force: true });
}

const assets = path.join(desktopDir, 'assets');
const build = path.join(desktopDir, 'build');
await mkdir(assets, { recursive: true });
await icns(appIconSvg(false), path.join(build, 'icon.icns'));
await png(appIconSvg(false), 1024, path.join(assets, 'icon.png'));
await png(appIconSvg(true), 1024, path.join(assets, 'icon-dev.png'));
await png(trayTemplateSvg(), 16, path.join(assets, 'trayTemplate.png'));
await png(trayTemplateSvg(), 32, path.join(assets, 'trayTemplate@2x.png'));
console.log(`Wrote icons to ${path.relative(process.cwd(), assets)} and build/icon.icns.`);
