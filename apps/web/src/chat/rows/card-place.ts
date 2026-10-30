export interface CardMark {
  id: string;
  time: number;
  textOffset?: number | undefined;
}

interface Timed {
  at: number;
  time: number | null;
}

export function cardAt(
  text: string,
  card: CardMark,
  others: readonly Timed[],
  placeAt: (offset: number) => number,
): number {
  if (card.textOffset !== undefined) return placeAt(card.textOffset);
  const later = others
    .filter((other) => other.time !== null && other.time >= card.time)
    .sort((left, right) => left.time! - right.time!)[0];
  return later ? later.at : text.length;
}
