const providerNames: Record<string, string> = {
  fake: 'Fake provider',
  claude: 'Claude',
  codex: 'Codex',
};

export function providerName(provider: string): string {
  return providerNames[provider] ?? provider;
}
