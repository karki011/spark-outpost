import { artifactUri, type PublishArtifactAction } from '@spark-outpost/contracts';
import { findVersion, publishVersion } from '../../artifacts/store.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export async function performPublishArtifact(
  context: SparkToolContext,
  action: PublishArtifactAction,
): Promise<Performed> {
  const conversationId = context.scope.conversationId;
  const stored = await findVersion(context.deps.db, action.artifactId, action.version);
  if (!stored || stored.conversationId !== conversationId || stored.sha256 !== action.sha256) {
    throw new SparkToolError('That artifact version is not in this chat.');
  }
  await publishVersion(context.deps.db, action.artifactId, action.version, context.scope.runId);
  return {
    message: `Showed ${action.title} (version ${action.version}) in the chat.`,
    url: null,
    output: {
      artifactId: action.artifactId,
      version: action.version,
      uri: artifactUri(stored.conversationId, action.artifactId),
    },
  };
}
