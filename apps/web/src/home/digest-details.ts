const DETAILS_KEY = 'spark-outpost.digest.details-open';

export function readDetailsOpen(): boolean {
  try {
    const saved = localStorage.getItem(DETAILS_KEY);
    return saved === '1';
  } catch {
    return false;
  }
}

export function writeDetailsOpen(open: boolean): void {
  try {
    localStorage.setItem(DETAILS_KEY, open ? '1' : '0');
  } catch {
    return;
  }
}
