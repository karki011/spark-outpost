export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function ellipsize(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
