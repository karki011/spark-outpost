export const LOCAL_ONLY_RULE =
  'Use only local file tools in this folder. Do not use any connector, web or cloud tool.';

export function withRule(text: string): string {
  return `${text.trim()}\n\n${LOCAL_ONLY_RULE}`;
}

export function afterRule(text: string): string {
  return `${LOCAL_ONLY_RULE}\n\n${text.trim()}`;
}
