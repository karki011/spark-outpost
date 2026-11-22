import { highlightParts } from './github-search.ts';

export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((part, index) =>
        part.hit ? (
          <mark key={index} className="gh-hit">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
