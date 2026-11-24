import './mark-tile.css';
import { LOGO_PATHS, type LogoName } from './logo-paths.ts';

const LETTER_MIN_SIZE = 20;

interface MarkTileProps {
  letters: string;
  size: number;
  hue?: number;
  logo?: LogoName | undefined;
}

function firstCharacter(word: string): string {
  return Array.from(word)[0] ?? '';
}

export function markLetters(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = firstCharacter(words[0]!);
  const second = words.length > 1 ? firstCharacter(words[words.length - 1]!) : '';
  return (first + second).toUpperCase();
}

export function MarkTile({ letters, size, hue, logo }: MarkTileProps) {
  const shown =
    !logo && size >= LETTER_MIN_SIZE
      ? Array.from(letters)
          .slice(0, size >= 28 ? 2 : 1)
          .join('')
      : '';
  return (
    <span
      className="mark-tile"
      data-tinted={hue === undefined ? undefined : 'true'}
      style={{
        width: size,
        height: size,
        ...(hue === undefined ? {} : { ['--mark-hue' as string]: hue }),
      }}
      data-letters={shown || undefined}
      aria-hidden="true"
    >
      {logo && (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d={LOGO_PATHS[logo]} />
        </svg>
      )}
    </span>
  );
}
