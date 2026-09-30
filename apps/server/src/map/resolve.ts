import { posix } from 'node:path';
import type { AliasScope, PackageEntry, ResolverConfig } from './resolver-config.ts';

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];
const STYLE_EXTENSIONS = ['.vue', '.svelte', '.json', '.css', '.scss'];
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};
const BUILD_FOLDERS = /^(?:dist|build|lib|out|esm|cjs)\//;
const MAX_GO_TARGETS = 40;

export type ImportLanguage = 'script' | 'python' | 'go';

export function importLanguage(language: string): ImportLanguage | null {
  if (language === 'typescript' || language === 'tsx' || language === 'javascript') return 'script';
  if (language === 'python' || language === 'go') return language;
  return null;
}

export interface Resolver {
  resolve(from: string, spec: string, language: ImportLanguage): string[];
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

function joinPath(base: string, relative: string): string | null {
  const joined = posix.normalize(posix.join(base, relative)).replace(/\/$/, '');
  if (joined === '..' || joined.startsWith('../')) return null;
  return joined === '' ? '.' : joined;
}

function isAncestor(dir: string, path: string): boolean {
  return dir === '.' || path.startsWith(`${dir}/`);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

function scriptCandidates(path: string): string[] {
  const extension = extensionOf(path);
  const swapped = (JS_TO_TS[extension] ?? []).map(
    (replacement) => path.slice(0, -extension.length) + replacement,
  );
  return [
    path,
    ...swapped,
    ...SCRIPT_EXTENSIONS.map((suffix) => path + suffix),
    ...STYLE_EXTENSIONS.map((suffix) => path + suffix),
    ...SCRIPT_EXTENSIONS.map((suffix) => `${path}/index${suffix}`),
  ];
}

function sourceTwin(path: string): string | null {
  if (!BUILD_FOLDERS.test(path)) return null;
  return path.replace(BUILD_FOLDERS, 'src/').replace(/\.d\.ts$|\.(?:m|c)?js$/, '');
}

function wildcard(pattern: string, spec: string): string | null {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === spec ? '' : null;
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  if (!spec.startsWith(head) || !spec.endsWith(tail) || spec.length < head.length + tail.length) {
    return null;
  }
  return spec.slice(head.length, spec.length - tail.length);
}

export function createResolver(files: ReadonlySet<string>, config: ResolverConfig): Resolver {
  const byDirectory = new Map<string, string[]>();
  for (const path of [...files].sort()) {
    const list = byDirectory.get(directoryOf(path)) ?? [];
    list.push(path);
    byDirectory.set(directoryOf(path), list);
  }
  const aliases = [...config.aliases].sort((a, b) => b.dir.length - a.dir.length);
  const packages = [...config.packages].sort((a, b) => b.name.length - a.name.length);

  function probe(path: string | null): string | null {
    if (path === null) return null;
    for (const candidate of scriptCandidates(path)) if (files.has(candidate)) return candidate;
    const twin = sourceTwin(path);
    return twin ? probe(twin) : null;
  }

  function viaAliases(from: string, spec: string): string | null {
    for (const scope of aliases) {
      if (!isAncestor(scope.dir, from)) continue;
      const found = viaScope(scope, spec);
      if (found) return found;
    }
    return null;
  }

  function viaScope(scope: AliasScope, spec: string): string | null {
    for (const [pattern, targets] of scope.paths) {
      const captured = wildcard(pattern, spec);
      if (captured === null) continue;
      for (const target of targets) {
        const found = probe(joinPath(scope.pathsBase, target.replace('*', captured)));
        if (found) return found;
      }
    }
    return scope.baseUrl ? probe(joinPath(scope.baseUrl, spec)) : null;
  }

  function viaPackage(entry: PackageEntry, spec: string): string | null {
    const subpath = spec === entry.name ? '.' : `.${spec.slice(entry.name.length)}`;
    for (const target of entry.entries.get(subpath) ?? []) {
      const found = probe(joinPath(entry.root, target));
      if (found) return found;
    }
    if (subpath === '.') {
      return probe(joinPath(entry.root, 'src/index')) ?? probe(joinPath(entry.root, 'index'));
    }
    return probe(joinPath(entry.root, subpath)) ?? probe(joinPath(entry.root, `src/${subpath}`));
  }

  function viaPackages(spec: string): string | null {
    for (const entry of packages) {
      if (spec === entry.name || spec.startsWith(`${entry.name}/`)) return viaPackage(entry, spec);
    }
    return null;
  }

  function resolveScript(from: string, raw: string): string | null {
    const spec = raw.split('?')[0] ?? raw;
    if (spec.startsWith('.')) return probe(joinPath(directoryOf(from), spec));
    if (spec.startsWith('/')) return probe(joinPath('.', spec.slice(1)));
    return viaAliases(from, spec) ?? viaPackages(spec);
  }

  function pythonFile(base: string): string | null {
    for (const candidate of [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`]) {
      if (files.has(candidate)) return candidate;
    }
    return null;
  }

  function resolvePython(from: string, spec: string): string | null {
    const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
    const rest = spec.slice(dots).replaceAll('.', '/');
    if (dots > 0) {
      let dir = directoryOf(from);
      for (let level = 1; level < dots; level += 1) dir = directoryOf(dir);
      const base = rest ? joinPath(dir, rest) : `${dir}/__init__`;
      return base ? pythonFile(base.replace(/\/__init__$/, '')) : null;
    }
    for (const root of config.pythonRoots) {
      const base = joinPath(root, rest);
      const found = base ? pythonFile(base) : null;
      if (found) return found;
    }
    return null;
  }

  function resolveGo(spec: string): string[] {
    for (const module of config.goModules) {
      if (spec !== module.module && !spec.startsWith(`${module.module}/`)) continue;
      const dir = joinPath(module.root, `.${spec.slice(module.module.length)}`);
      const listed = dir ? (byDirectory.get(dir) ?? []) : [];
      return listed
        .filter((path) => path.endsWith('.go') && !path.endsWith('_test.go'))
        .slice(0, MAX_GO_TARGETS);
    }
    return [];
  }

  return {
    resolve(from, spec, language) {
      if (language === 'go') return resolveGo(spec).filter((path) => path !== from);
      const found = language === 'python' ? resolvePython(from, spec) : resolveScript(from, spec);
      return found && found !== from ? [found] : [];
    },
  };
}
