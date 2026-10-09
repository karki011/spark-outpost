function handleList(handles: readonly string[]): string {
  const named = handles.map((handle) => `@${handle}`);
  const last = named.at(-1) ?? '';
  if (named.length < 2) return last;
  return `${named.slice(0, -1).join(', ')} and ${last}`;
}

export function joinNotice(joined: string, members: readonly string[]): string {
  const others = members.filter((handle) => handle !== joined);
  if (others.length === 0) return `@${joined} joined.`;
  return `@${joined} joined. ${handleList([...others, joined])} can now ask each other.`;
}
