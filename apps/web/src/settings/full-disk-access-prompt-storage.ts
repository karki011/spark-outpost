const SILENCED_KEY = 'spark-outpost.full-disk-access-prompt';

export function isPromptSilenced(): boolean {
  try {
    return localStorage.getItem(SILENCED_KEY) === 'silenced';
  } catch {
    return false;
  }
}

export function silencePrompt(): void {
  try {
    localStorage.setItem(SILENCED_KEY, 'silenced');
  } catch {
    return;
  }
}
