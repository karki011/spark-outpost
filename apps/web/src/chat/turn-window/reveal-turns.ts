type Reveal = () => void;

const threads = new Set<Reveal>();

export function onRevealTurns(reveal: Reveal): () => void {
  threads.add(reveal);
  return () => {
    threads.delete(reveal);
  };
}

export function revealAllTurns(): void {
  for (const reveal of threads) reveal();
}
