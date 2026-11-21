export function proposedAboveOwnMode(name: string): string {
  return `${name} cannot be proposed in a mode that asks less often than this chat's own. Propose a mode that asks at least as often, or leave the mode out.`;
}
