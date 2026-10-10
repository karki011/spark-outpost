import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const TEMPLATE_DIR = join(import.meta.dirname, 'template');
const SUFFIX = '.tpl';
const DOT_PREFIX = 'dot-';

export interface TemplateFile {
  source: string;
  target: string;
}

export function targetPath(templatePath: string): string {
  if (!templatePath.endsWith(SUFFIX)) throw new Error(`${templatePath} is not a template file.`);
  return templatePath
    .slice(0, -SUFFIX.length)
    .split('/')
    .map((part) => (part.startsWith(DOT_PREFIX) ? `.${part.slice(DOT_PREFIX.length)}` : part))
    .join('/');
}

export async function templateFiles(dir: string = TEMPLATE_DIR): Promise<TemplateFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(SUFFIX))
    .map((entry) => {
      const source = join(entry.parentPath, entry.name);
      return { source, target: targetPath(source.slice(dir.length + 1)) };
    })
    .sort((a, b) => a.target.localeCompare(b.target));
}
