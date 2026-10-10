export interface OpenWait {
  from: string;
  to: string;
}

function waitedOnBy(chat: string, openWaits: readonly OpenWait[]): string[] {
  return openWaits.filter((wait) => wait.from === chat).map((wait) => wait.to);
}

export function wouldDeadlock(
  asker: string,
  target: string,
  openWaits: readonly OpenWait[],
): boolean {
  const seen = new Set<string>();
  const next = [target];
  for (let chat = next.pop(); chat !== undefined; chat = next.pop()) {
    if (chat === asker) return true;
    if (seen.has(chat)) continue;
    seen.add(chat);
    next.push(...waitedOnBy(chat, openWaits));
  }
  return false;
}
