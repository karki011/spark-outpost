import './spark-icon.css';
import { LaptopIcon } from '../ui/icons.tsx';

const TWO_LETTER_SIZE = 28;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function sparkInitials(name: string): string {
  const words = name.match(WORD) ?? [];
  const letters =
    words.length > 1
      ? [words[0]!, words[1]!].map((word) => Array.from(word)[0]!)
      : Array.from(words[0] ?? '').slice(0, 2);
  return letters.join('').toLocaleUpperCase();
}

interface SparkIconProps {
  icon: string | null;
  size: number;
  name?: string | null;
}

export function SparkIcon({ icon, size, name = null }: SparkIconProps) {
  const letters = name === null ? [] : Array.from(sparkInitials(name));
  const initials = letters.slice(0, size >= TWO_LETTER_SIZE ? 2 : 1).join('');
  return (
    <i className="rs-icon" style={{ width: size, height: size }} aria-hidden="true">
      {icon !== null ? (
        <img src={icon} alt="" width={size} height={size} loading="lazy" decoding="async" />
      ) : initials !== '' ? (
        <b className="rs-initials" style={{ fontSize: Math.max(12, Math.round(size * 0.42)) }}>
          {initials}
        </b>
      ) : (
        <LaptopIcon />
      )}
    </i>
  );
}
