import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest']);

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function writeIfSmaller(file: string, original: Buffer, compressed: Buffer) {
  if (compressed.length < original.length) writeFileSync(file, compressed);
}

export function precompressPlugin(): Plugin {
  let outDirectory = '';
  return {
    name: 'spark-precompress',
    apply: 'build',
    configResolved(config) {
      outDirectory = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of filesUnder(outDirectory)) {
        if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
        const original = readFileSync(file);
        const brotli = brotliCompressSync(original, {
          params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
        });
        writeIfSmaller(`${file}.br`, original, brotli);
        writeIfSmaller(`${file}.gz`, original, gzipSync(original, { level: 9 }));
      }
    },
  };
}
