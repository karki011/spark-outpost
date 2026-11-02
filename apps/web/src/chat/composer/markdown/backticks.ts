export function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

export function codeSpan(core: string): string {
  const fence = '`'.repeat(longestBacktickRun(core) + 1);
  const pad = core.startsWith('`') || core.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${core}${pad}${fence}`;
}

export function codeFence(body: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}\n${body}\n${fence}`;
}
