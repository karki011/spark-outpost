import { archLabel, dmgUrl, guessArch, readArchHints, type ArchGuess } from './arch.ts';

function otherArch(guess: ArchGuess): 'arm64' | 'x64' {
  return guess.arch === 'arm64' ? 'x64' : 'arm64';
}

function applyGuess(guess: ArchGuess): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-download]')) {
    link.href = dmgUrl(guess.arch);
    const label = link.querySelector('[data-download-arch]');
    if (label) label.textContent = archLabel(guess.arch);
  }
  const other = otherArch(guess);
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-download-other]')) {
    link.href = dmgUrl(other);
    link.textContent = guess.sure ? `Download for ${archLabel(other)}` : `${archLabel(other)} Mac?`;
  }
}

export async function setUpDownloads(): Promise<void> {
  applyGuess(guessArch(null));
  const hints = await readArchHints(navigator as Navigator & Parameters<typeof readArchHints>[0]);
  applyGuess(guessArch(hints));
}
