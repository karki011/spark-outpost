import type { ContentBlock, ToolCallContent } from '@agentclientprotocol/sdk/unstable';
import { parseArtifactUri } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';

function linkOf(block: ContentBlock): ProviderOutput[] {
  if (block.type !== 'resource_link') return [];
  const parsed = parseArtifactUri(block.uri);
  return parsed ? [{ kind: 'artifact_link', ...parsed }] : [];
}

export function artifactLinks(
  content: ContentBlock | readonly ToolCallContent[] | null | undefined,
): ProviderOutput[] {
  if (!content) return [];
  if (!Array.isArray(content)) return linkOf(content as ContentBlock);
  return (content as readonly ToolCallContent[]).flatMap((item) =>
    item.type === 'content' ? linkOf(item.content) : [],
  );
}
