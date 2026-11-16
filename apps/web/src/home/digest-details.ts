const DETAILS_KEY = 'spark-outpost.digest.details-open';

export function readDetailsOpen(key = DETAILS_KEY): boolean {
  try {
    const saved = localStorage.getItem(key);
    return saved === '1';
  } catch {
    return false;
  }
}

export function writeDetailsOpen(open: boolean, key = DETAILS_KEY): void {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    return;
  }
}
