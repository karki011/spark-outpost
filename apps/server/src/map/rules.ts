import type { MapCategory, MapKind } from '@spark-outpost/contracts';
import { isTestFile } from '../codescan/test-pairs.ts';

export interface AreaFacts {
  root: string;
  source: string;
  files: readonly { path: string; language: string; routes: number }[];
  usedBy: number;
  uses: number;
}

const KIND_PATHS: [RegExp, MapKind][] = [
  [
    /(?:^|\/)(?:\.github|\.gitlab|\.circleci|infra|deploy|docker|k8s|helm|terraform|ops)(?:\/|$)/i,
    'infra',
  ],
  [/(?:^|\/)(?:auth|security|permissions?)(?:\/|$)/i, 'auth'],
  [/(?:^|\/)(?:migrations?|db|database|persistence|models?|schema|repositories)(?:\/|$)/i, 'data'],
  [/(?:^|\/)(?:api|routes?|controllers?|handlers?|endpoints?|resolvers?)(?:\/|$)/i, 'api'],
  [
    /(?:^|\/)(?:providers?|integrations?|clients?|adapters?|sdk|connectors?)(?:\/|$)/i,
    'integration',
  ],
  [/(?:^|\/)(?:scripts?|tools?|bin|tooling)(?:\/|$)/i, 'tooling'],
  [/(?:^|\/)(?:components?|ui|pages|views|screens|styles?|design|theme)(?:\/|$)/i, 'ui'],
];

const UI_LANGUAGES = new Set(['tsx', 'jsx', 'vue', 'svelte', 'css', 'scss', 'html']);
const DOC_LANGUAGES = new Set(['md', 'mdx', 'rst', 'txt', 'adoc']);
const CONFIG_LANGUAGES = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'cfg']);
const SHARED_ROOTS =
  /(?:^|\/)(?:packages|libs?|shared|common|utils?|contracts|core-lib|design-system)(?:\/|$)/i;
const FEATURE_ROOTS = /(?:^|\/)(?:features?|modules)\//i;
const CORE_KINDS = new Set<MapKind>(['data', 'auth', 'infra', 'config']);

function share(files: AreaFacts['files'], test: (file: AreaFacts['files'][number]) => boolean) {
  if (files.length === 0) return 0;
  return files.filter(test).length / files.length;
}

export function ruleKind(facts: AreaFacts): MapKind {
  const { files } = facts;
  if (
    share(
      files,
      (file) => isTestFile(file.path) || /(?:^|\/)(?:tests?|e2e|__tests__)\//.test(file.path),
    ) >= 0.6
  ) {
    return 'tests';
  }
  if (share(files, (file) => DOC_LANGUAGES.has(file.language)) >= 0.6) return 'docs';
  for (const [pattern, kind] of KIND_PATHS) if (pattern.test(`${facts.root}/`)) return kind;
  if (share(files, (file) => CONFIG_LANGUAGES.has(file.language)) >= 0.6) return 'config';
  if (files.some((file) => file.routes > 0)) return 'api';
  if (share(files, (file) => UI_LANGUAGES.has(file.language)) >= 0.5) return 'ui';
  return 'domain';
}

export function ruleCategory(facts: AreaFacts, kind: MapKind): MapCategory {
  if (FEATURE_ROOTS.test(`${facts.root}/`)) return 'feature';
  if (SHARED_ROOTS.test(`${facts.root}/`)) return 'shared';
  if (facts.usedBy >= 3 && facts.usedBy >= facts.uses * 2) return 'shared';
  if (CORE_KINDS.has(kind)) return 'core';
  if (facts.source === 'root') return 'core';
  return 'feature';
}
