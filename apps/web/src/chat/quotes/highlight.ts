export function paintHighlight(name: string, ranges: readonly Range[]): () => void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') {
    return () => undefined;
  }
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return () => undefined;
  }
  const highlight = new Highlight(...ranges);
  CSS.highlights.set(name, highlight);
  return () => {
    if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
  };
}
