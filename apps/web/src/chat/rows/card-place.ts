export interface CardMark {
  id: string;
  time: number;
  textOffset?: number | undefined;
}

export interface TimedItem {
  at: number;
  time: number | null;
  until: number | null;
}

function openAt(items: readonly TimedItem[], time: number): TimedItem | undefined {
  return items
    .filter((item) => item.time !== null && item.time <= time)
    .filter((item) => item.until !== null && item.until >= time)
    .sort((left, right) => right.time! - left.time!)[0];
}

function nextAfter(items: readonly TimedItem[], time: number): TimedItem | undefined {
  return items
    .filter((item) => item.time !== null && item.time >= time)
    .sort((left, right) => left.time! - right.time!)[0];
}

export function cardAt(
  text: string,
  card: CardMark,
  items: readonly TimedItem[],
  placeAt: (offset: number) => number,
): number {
  if (card.textOffset !== undefined) return placeAt(card.textOffset);
  const anchor = openAt(items, card.time) ?? nextAfter(items, card.time);
  return anchor ? anchor.at : text.length;
}
