const STRONG = /\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g;

export function thoughtText(text: string): string {
  return text.replace(STRONG, '$1');
}
