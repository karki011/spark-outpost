export function titleCase(text: string): string {
  return text
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
