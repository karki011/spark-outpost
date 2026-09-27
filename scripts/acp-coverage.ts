import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

const SCHEMA_PATH = 'docs/reference/acp/schema.json';
const STATUS_PATH = 'docs/architecture/acp-coverage.json';
const DOC_PATH = 'docs/architecture/ACP_COVERAGE.md';
const START_MARKER = '<!-- acp-coverage:start -->';
const END_MARKER = '<!-- acp-coverage:end -->';
const WHERE_PREFIX = 'apps/server/src/agents/acp/';
const OUTSIDE_SCHEMA = 'Unstable (outside the stable v1 schema)';
const SDK_PACKAGE = '@agentclientprotocol/sdk';
const UNSTABLE_SCHEMA = `${SDK_PACKAGE}/schema/schema.json`;

interface JsonSchema {
  $ref?: string;
  const?: string;
  title?: string;
  properties?: Record<string, JsonSchema>;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  'x-method'?: string;
}

interface SchemaFile extends JsonSchema {
  $defs: Record<string, JsonSchema>;
}

interface Surface {
  id: string;
  area: string;
}

const statuses = ['supported', 'partial', 'missing', 'not_applicable'] as const;
type Status = (typeof statuses)[number];

const entrySchema = z.object({
  status: z.enum(statuses),
  where: z.string().optional(),
  note: z.string().optional(),
});
const statusFileSchema = z.record(z.string(), entrySchema);
type Entry = z.infer<typeof entrySchema>;
type StatusFile = z.infer<typeof statusFileSchema>;

function definition(schema: SchemaFile, name: string): JsonSchema {
  const found = schema.$defs[name];
  if (!found) throw new Error(`${SCHEMA_PATH} has no $defs.${name}`);
  return found;
}

function refName(node: JsonSchema): string | null {
  const refs = [node, ...(node.allOf ?? []), ...(node.anyOf ?? [])];
  const ref = refs.find((candidate) => candidate.$ref)?.$ref;
  return ref ? (ref.split('/').at(-1) ?? null) : null;
}

function unionMembers(message: JsonSchema): JsonSchema[] {
  const params = message.properties?.params?.anyOf ?? [];
  return params.flatMap((option) => option.anyOf ?? []);
}

function methodNames(schema: SchemaFile, message: JsonSchema): string[] {
  return unionMembers(message).map((member) => {
    const name = refName(member);
    return (name && schema.$defs[name]?.['x-method']) || '_*';
  });
}

function discriminants(schema: SchemaFile, name: string, key: string): string[] {
  return (definition(schema, name).oneOf ?? []).flatMap((variant) => {
    const value = key ? variant.properties?.[key]?.const : variant.const;
    return value ? [value] : [];
  });
}

function propertyNames(node: JsonSchema): string[] {
  return Object.keys(node.properties ?? {}).filter((key) => key !== '_meta');
}

function capabilityFields(schema: SchemaFile, name: string, path = ''): string[] {
  const node = definition(schema, name);
  return propertyNames(node).flatMap((key) => {
    const field = path ? `${path}.${key}` : key;
    const child = refName(node.properties?.[key] ?? {});
    const nested = child?.endsWith('Capabilities') ? child : null;
    return nested && propertyNames(definition(schema, nested)).length > 0
      ? capabilityFields(schema, nested, field)
      : [field];
  });
}

function protocolMessage(schema: SchemaFile): JsonSchema {
  const found = (schema.anyOf ?? []).find((option) => option.title === 'ProtocolLevel');
  if (!found) throw new Error(`${SCHEMA_PATH} has no ProtocolLevel messages`);
  return found;
}

function listSurfaces(schema: SchemaFile): Surface[] {
  const group = (area: string, prefix: string, names: string[]): Surface[] =>
    names.map((name) => ({ id: `${prefix}:${name}`, area }));
  const union = (name: string) => methodNames(schema, definition(schema, name));
  return [
    ...group('Agent methods (client → agent)', 'agent-method', union('ClientRequest')),
    ...group('Client methods (agent → client)', 'client-method', union('AgentRequest')),
    ...group('Notifications', 'agent-notification', union('AgentNotification')),
    ...group('Notifications', 'client-notification', union('ClientNotification')),
    ...group(
      'Notifications',
      'protocol-notification',
      methodNames(schema, protocolMessage(schema)),
    ),
    ...group(
      'Session updates',
      'session-update',
      discriminants(schema, 'SessionUpdate', 'sessionUpdate'),
    ),
    ...group('Content blocks', 'content-block', discriminants(schema, 'ContentBlock', 'type')),
    ...group(
      'Tool call content',
      'tool-call-content',
      discriminants(schema, 'ToolCallContent', 'type'),
    ),
    ...group(
      'Agent capabilities',
      'agent-capability',
      capabilityFields(schema, 'AgentCapabilities'),
    ),
    ...group(
      'Client capabilities',
      'client-capability',
      capabilityFields(schema, 'ClientCapabilities'),
    ),
    ...group('Stop reasons', 'stop-reason', discriminants(schema, 'StopReason', '')),
    ...group(
      'Permission option kinds',
      'permission-option-kind',
      discriminants(schema, 'PermissionOptionKind', ''),
    ),
    ...group('Plan entry fields', 'plan-entry', propertyNames(definition(schema, 'PlanEntry'))),
  ];
}

interface Row extends Surface {
  entry: Entry;
}

function rowsFor(surfaces: readonly Surface[], coverage: StatusFile): Row[] {
  const known = new Set(surfaces.map((surface) => surface.id));
  const tracked = surfaces.flatMap((surface) => {
    const entry = coverage[surface.id];
    return entry ? [{ ...surface, entry }] : [];
  });
  const extra = Object.entries(coverage)
    .filter(([id]) => !known.has(id))
    .map(([id, entry]) => ({ id, area: OUTSIDE_SCHEMA, entry }));
  return [...tracked, ...extra];
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const whereCell = (where: string | undefined) =>
  where
    ? where
        .split(',')
        .map((path) => `\`${path.trim().replace(WHERE_PREFIX, '')}\``)
        .join(', ')
    : '—';

function summaryTable(rows: readonly Row[]): string[] {
  const areas = [...new Set(rows.map((row) => row.area))];
  const count = (subset: readonly Row[], status: Status) =>
    subset.filter((row) => row.entry.status === status).length;
  const line = (label: string, subset: readonly Row[]) =>
    `| ${label} | ${statuses.map((status) => count(subset, status)).join(' | ')} | ${subset.length} |`;
  return [
    `| Area | ${statuses.join(' | ')} | Total |`,
    `| --- | ${statuses.map(() => '---:').join(' | ')} | ---: |`,
    ...areas.map((area) =>
      line(
        area,
        rows.filter((row) => row.area === area),
      ),
    ),
    line('**Total**', rows),
  ];
}

function areaTables(rows: readonly Row[]): string[] {
  const areas = [...new Set(rows.map((row) => row.area))];
  return areas.flatMap((area) => [
    `### ${area}`,
    '',
    '| Surface | Status | Where | Note |',
    '| --- | --- | --- | --- |',
    ...rows
      .filter((row) => row.area === area)
      .map(
        (row) =>
          `| \`${row.id}\` | ${row.entry.status} | ${whereCell(row.entry.where)} | ${cell(row.entry.note ?? '')} |`,
      ),
    '',
  ]);
}

function renderBlock(rows: readonly Row[]): string {
  return [
    START_MARKER,
    '',
    '## Summary',
    '',
    ...summaryTable(rows),
    '',
    '## Surfaces by area',
    '',
    ...areaTables(rows),
    END_MARKER,
  ].join('\n');
}

async function renderDoc(rows: readonly Row[]): Promise<string> {
  const doc = readFileSync(DOC_PATH, 'utf8');
  const start = doc.indexOf(START_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start < 0 || end < start) {
    throw new Error(`${DOC_PATH} needs the ${START_MARKER} and ${END_MARKER} markers`);
  }
  const text = doc.slice(0, start) + renderBlock(rows) + doc.slice(end + END_MARKER.length);
  const config = (await resolveConfig(DOC_PATH)) ?? {};
  return format(text, { ...config, filepath: DOC_PATH });
}

function problems(
  surfaces: readonly Surface[],
  unstable: ReadonlySet<string>,
  coverage: StatusFile,
): string[] {
  const known = new Set(surfaces.map((surface) => surface.id));
  const untracked = surfaces
    .filter((surface) => !coverage[surface.id])
    .map((surface) => `No entry for ${surface.id} (${surface.area})`);
  const unknown = Object.keys(coverage)
    .filter((id) => !known.has(id) && !unstable.has(id))
    .map((id) => `${id} is in neither ${SCHEMA_PATH} nor the SDK's unstable schema`);
  const unexplained = Object.entries(coverage)
    .filter(([, entry]) => entry.status === 'partial' && !entry.note?.trim())
    .map(([id]) => `${id} is partial but has no note saying what is missing`);
  return [...untracked, ...unknown, ...unexplained];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function unstableSurfaceIds(): Set<string> {
  const require = createRequire(resolve('apps/server/package.json'));
  const unstable = readJson(require.resolve(UNSTABLE_SCHEMA)) as SchemaFile;
  return new Set(listSurfaces(unstable).map((surface) => surface.id));
}

const schema = readJson(SCHEMA_PATH) as SchemaFile;
const coverage = statusFileSchema.parse(readJson(STATUS_PATH));
const surfaces = listSurfaces(schema);
const unstable = unstableSurfaceIds();
const rows = rowsFor(surfaces, coverage);
const command = process.argv[2] ?? 'check';

if (command === 'render') {
  writeFileSync(DOC_PATH, await renderDoc(rows));
  console.log(`Rendered ${DOC_PATH} from ${rows.length} entries.`);
} else if (command === 'check') {
  const found = problems(surfaces, unstable, coverage);
  for (const row of rows.filter((candidate) => candidate.area === OUTSIDE_SCHEMA)) {
    console.warn(
      `Unstable in ${SDK_PACKAGE}, not in the v1 schema: ${row.id} (${row.entry.status})`,
    );
  }
  if ((await renderDoc(rows)) !== readFileSync(DOC_PATH, 'utf8')) {
    found.push(`${DOC_PATH} is out of date. Run pnpm acp:coverage render`);
  }
  if (found.length > 0) {
    for (const problem of found) console.error(problem);
    console.error(`\n${found.length} ACP coverage problem(s). Update ${STATUS_PATH}.`);
    process.exit(1);
  }
  const counts = statuses.map(
    (status) => `${status} ${rows.filter((row) => row.entry.status === status).length}`,
  );
  console.log(`ACP coverage tracks all ${surfaces.length} schema surfaces: ${counts.join(', ')}.`);
} else {
  console.error('Usage:\n  pnpm acp:coverage [check]\n  pnpm acp:coverage render');
  process.exit(1);
}
