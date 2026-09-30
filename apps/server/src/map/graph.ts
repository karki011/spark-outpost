import type { Endpoint } from '../codescan/endpoints.ts';
import { importLanguage, type Resolver } from './resolve.ts';

export interface SourceFile {
  path: string;
  language: string;
  package: string;
  lines: number;
  hasTest: boolean;
  imports: readonly string[];
  endpoints: readonly Endpoint[];
}

export interface ImportGraph {
  edges: [string, string][];
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
}

export function buildGraph(files: readonly SourceFile[], resolver: Resolver): ImportGraph {
  const edges: [string, string][] = [];
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const file of files) {
    const language = importLanguage(file.language);
    if (!language) continue;
    const targets = new Set<string>();
    for (const spec of file.imports) {
      for (const target of resolver.resolve(file.path, spec, language)) targets.add(target);
    }
    for (const target of [...targets].sort()) {
      edges.push([file.path, target]);
      fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
    }
    fanOut.set(file.path, targets.size);
  }
  return { edges, fanIn, fanOut };
}
