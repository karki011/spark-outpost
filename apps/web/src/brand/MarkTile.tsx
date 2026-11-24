import './mark-tile.css';

const LETTER_MIN_SIZE = 20;

interface MarkTileProps {
  letters: string;
  size: number;
  hue?: number;
}

export function markLetters(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0]!;
  const second = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + second).toUpperCase();
}

export function MarkTile({ letters, size, hue }: MarkTileProps) {
  const shown = size >= LETTER_MIN_SIZE ? letters.slice(0, size >= 28 ? 2 : 1) : '';
  return (
    <span
      className="mark-tile"
      data-tinted={hue === undefined ? undefined : 'true'}
      style={{
        width: size,
        height: size,
        ...(hue === undefined ? {} : { ['--mark-hue' as string]: hue }),
      }}
      aria-hidden="true"
    >
      {shown}
    </span>
  );
}
