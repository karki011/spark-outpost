import { MAP_FILE_KINDS, type MapFileKind } from '@spark-outpost/contracts';

export const FILE_KINDS = MAP_FILE_KINDS;
export type FileKind = MapFileKind;

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  ui: 'UI',
  api: 'API',
  data: 'Data',
  test: 'Tests',
  config: 'Config',
  other: 'Other',
};

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function shortName(path: string): string {
  return baseName(path).replace(/\.(tsx?|jsx?|mjs|cjs|css|py|go|rs|rb|java|kt)$/, '');
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}
