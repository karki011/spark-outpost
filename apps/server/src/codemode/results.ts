import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function codeModeResult(result: CallToolResult) {
  const answer = { isError: result.isError === true, content: result.content };
  const first = result.content[0];
  if (answer.isError || result.content.length !== 1 || first?.type !== 'text') return answer;
  try {
    return { ...answer, data: JSON.parse(first.text) as unknown };
  } catch {
    return answer;
  }
}
