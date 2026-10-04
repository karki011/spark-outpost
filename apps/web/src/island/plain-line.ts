export function plainLine(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const SENTENCE_END = /[.!?](?=\s|$)/;
const SENTENCE_CHARS = 140;

export function firstSentence(markdown: string, max = SENTENCE_CHARS): string {
  const blocks = markdown.replace(/```[\s\S]*?```/g, '\n\n').split(/\n\s*\n/);
  const text = blocks.map(plainLine).find(Boolean) ?? '';
  const end = text.search(SENTENCE_END);
  const sentence = end < 0 ? text : text.slice(0, end + 1);
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}
