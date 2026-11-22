export function completeReply(buffer: string, id: number): string | null {
  const complete = buffer.split('\n').slice(0, -1);
  return complete.find((line) => replyId(line) === id) ?? null;
}

function replyId(line: string): unknown {
  try {
    return (JSON.parse(line) as { id?: unknown }).id;
  } catch {
    return undefined;
  }
}
