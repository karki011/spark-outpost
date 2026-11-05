export { providerName } from '@spark-outpost/contracts';

export function providerColor(provider: string): string {
  return `var(--c-${provider}, var(--muted))`;
}
