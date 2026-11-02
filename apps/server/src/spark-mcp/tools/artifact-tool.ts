import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ARTIFACT_HTML_MIME,
  ARTIFACT_KIND_LABELS,
  artifactPageKindSchema,
  artifactUri,
  type ArtifactPageKind,
  type PublishArtifactAction,
} from '@spark-outpost/contracts';
import {
  ArtifactContentError,
  cleanTitle,
  newViewKey,
  prepareContent,
  readVersionFile,
  writeVersionFile,
  removeVersionFile,
} from '../../artifacts/files.ts';
import {
  artifactInChat,
  findVersion,
  insertVersion,
  lastVersionNumber,
} from '../../artifacts/store.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { ACTION_NOTE } from '../actions/action-note.ts';
import { artifactActivity } from '../../artifacts/activity.ts';
import { proposeAction } from '../actions/confirm.ts';
import { renderResult } from '../format.ts';
import {
  SparkBlocks,
  sparkTool,
  SparkToolError,
  uuidInput,
  type SparkResourceLink,
  type SparkToolContext,
} from '../tool.ts';
import { pageScrub, secretFileScrubber } from './browser/scrub.ts';
import { projectSecretValues } from '../../audit/secret-values.ts';
import { chatWorkFolder } from '../../chat-files/folders.ts';

const MIME_TYPES: Record<ArtifactPageKind, string> = {
  html: ARTIFACT_HTML_MIME,
  markdown: 'text/markdown',
  svg: 'image/svg+xml',
};

const CONTENT_INPUT_MAX = 4 * 1024 * 1024;

interface ChatPlace {
  base: string;
  conversationId: string;
  runId: string | null;
}

function chatPlace(context: SparkToolContext): ChatPlace {
  const base = context.deps.chatFolders;
  const conversationId = context.scope.conversationId;
  if (!base || !conversationId) {
    throw new SparkToolError('Artifacts need a chat; this session has none.');
  }
  return { base, conversationId, runId: context.scope.runId };
}

export function artifactLink(
  conversationId: string,
  artifactId: string,
  title: string,
  kind: ArtifactPageKind,
): SparkResourceLink {
  return {
    type: 'resource_link',
    uri: artifactUri(conversationId, artifactId),
    name: title,
    title,
    mimeType: MIME_TYPES[kind],
    _meta: {
      ui: {
        csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
        prefersBorder: true,
      },
    },
  };
}

interface Staged {
  place: ChatPlace;
  action: PublishArtifactAction;
}

async function stage(
  context: SparkToolContext,
  place: ChatPlace,
  facts: { artifactId: string; version: number; title: string; kind: ArtifactPageKind },
  content: string,
): Promise<Staged> {
  const page = await pageScrub(context);
  const own = secretFileScrubber(
    await projectSecretValues([chatWorkFolder(place.base, place.conversationId)]),
  );
  const scrub = (text: string) => (own ? own(page(text)) : page(text));
  const prepared = (() => {
    try {
      return prepareContent(facts.kind, content, scrub);
    } catch (error) {
      if (error instanceof ArtifactContentError) throw new SparkToolError(error.message);
      throw error;
    }
  })();
  await writeVersionFile(
    place.base,
    place.conversationId,
    facts.artifactId,
    facts.version,
    prepared.text,
  );
  try {
    await insertVersion(context.deps.db, {
      ...facts,
      conversationId: place.conversationId,
      bytes: prepared.bytes,
      sha256: prepared.sha256,
      viewKey: newViewKey(),
      runId: place.runId,
    });
  } catch (error) {
    await removeVersionFile(place.base, place.conversationId, facts.artifactId, facts.version);
    throw error;
  }
  return {
    place,
    action: {
      action: 'publish_artifact',
      artifactId: facts.artifactId,
      version: facts.version,
      title: facts.title,
      kind: facts.kind,
      bytes: prepared.bytes,
      sha256: prepared.sha256,
    },
  };
}

async function shown(context: SparkToolContext, staged: Staged) {
  const result = await proposeAction(context, staged.action);
  if (result.outcome !== 'done') return result;
  const { action, place } = staged;
  await context.scope.actions
    ?.append(artifactActivity(action.artifactId, action.version))
    .catch((error: unknown) => {
      if (!(error instanceof LeaseLostError)) throw error;
    });
  const facts = {
    outcome: 'done',
    id: action.artifactId,
    version: action.version,
    uri: artifactUri(place.conversationId, action.artifactId),
    shownToUser: `${ARTIFACT_KIND_LABELS[action.kind]} artifact "${action.title}" version ${action.version} is shown in the chat; the user opens it beside the chat.`,
  };
  return new SparkBlocks([
    { type: 'text', text: renderResult(facts) },
    artifactLink(place.conversationId, action.artifactId, action.title, action.kind),
  ]);
}

async function publish(
  context: SparkToolContext,
  args: {
    title?: string | undefined;
    kind?: ArtifactPageKind | undefined;
    content?: string | undefined;
  },
) {
  const place = chatPlace(context);
  if (!args.title || !args.kind || args.content === undefined) {
    throw new SparkToolError('publish needs title, kind and content.');
  }
  const facts = {
    artifactId: randomUUID(),
    version: 1,
    title: cleanTitle(args.title),
    kind: args.kind,
  };
  return shown(context, await stage(context, place, facts, args.content));
}

async function ownArtifact(context: SparkToolContext, place: ChatPlace, id: string) {
  const found = await artifactInChat(context.deps.db, id, place.conversationId);
  if (!found) throw new SparkToolError('No artifact with that id in this chat.');
  return found;
}

async function update(
  context: SparkToolContext,
  args: { id?: string | undefined; title?: string | undefined; content?: string | undefined },
) {
  const place = chatPlace(context);
  if (!args.id || args.content === undefined) {
    throw new SparkToolError('update needs id and content.');
  }
  const { kind } = await ownArtifact(context, place, args.id);
  const latest = await findVersion(context.deps.db, args.id, null);
  const facts = {
    artifactId: args.id,
    version: (await lastVersionNumber(context.deps.db, args.id)) + 1,
    title: cleanTitle(args.title ?? latest?.title ?? 'Artifact'),
    kind,
  };
  return shown(context, await stage(context, place, facts, args.content));
}

async function read(
  context: SparkToolContext,
  args: { id?: string | undefined; version?: number | undefined },
) {
  const place = chatPlace(context);
  if (!args.id) throw new SparkToolError('read needs id.');
  await ownArtifact(context, place, args.id);
  const stored = await findVersion(context.deps.db, args.id, args.version ?? null);
  if (!stored?.published) throw new SparkToolError('That version was never shown in the chat.');
  const content = await readVersionFile(place.base, stored);
  if (content === null) throw new SparkToolError('That version could not be read.');
  const facts = {
    id: stored.artifactId,
    version: stored.version,
    title: stored.title,
    kind: stored.kind,
    content: 'The next block is the content, as stored.',
  };
  return new SparkBlocks([
    { type: 'text', text: renderResult(facts) },
    { type: 'text', text: content },
  ]);
}

export const artifactTool = sparkTool({
  name: 'spark_artifact',
  title: 'Artifact',
  acts: true,
  description: `Show a page you made beside the chat: action publish {title, kind: html|markdown|svg, content} makes a new artifact, update {id, content, title?} adds a version, read {id, version?} returns a version's content. HTML runs sandboxed with inline scripts and styles only: no network, no fetch, no external files, forms or frames, so inline any data, styles and images (data: URIs). Up to 2 MB. Values from secret files and saved sign-ins are removed. The result links the artifact as an MCP Apps ui:// resource. publish and update: ${ACTION_NOTE}`,
  input: {
    action: z.enum(['publish', 'update', 'read']),
    id: uuidInput.optional(),
    version: z.number().int().positive().optional(),
    title: z.string().max(400).optional(),
    kind: artifactPageKindSchema.optional(),
    content: z.string().max(CONTENT_INPUT_MAX).optional(),
  },
  run: (args, context) => {
    if (args.action === 'publish') return publish(context, args);
    if (args.action === 'update') return update(context, args);
    return read(context, args);
  },
});
