export type LinkGesture = 'peek' | 'split';

export interface OpenDetails {
  disposition: string;
  features: string;
}

export interface KeyFacts {
  type: string;
  key: string;
  alt: boolean;
}

const CLICK_WINDOW_MS = 1000;
const OPTION_HELD_MS = 10_000;

export function shiftedLinkClick(
  details: OpenDetails,
  clickAt: number | null,
  now: number,
): boolean {
  if (details.disposition !== 'new-window' || details.features !== '') return false;
  return clickAt !== null && now - clickAt <= CLICK_WINDOW_MS;
}

export class OptionKey {
  private downAt: number | null = null;

  note(input: KeyFacts, now: number): void {
    if (input.key === 'Alt') this.downAt = input.type === 'keyUp' ? null : now;
    else if (!input.alt) this.downAt = null;
  }

  held(now: number): boolean {
    return this.downAt !== null && now - this.downAt <= OPTION_HELD_MS;
  }
}
