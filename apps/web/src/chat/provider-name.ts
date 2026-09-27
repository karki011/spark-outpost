const providerNames: Record<string, string> = {
  fake: 'Fake provider',
  claude: 'Claude',
  codex: 'Codex',
  zai: 'Z.ai (GLM)',
};

export function providerName(provider: string): string {
  return providerNames[provider] ?? provider;
}
