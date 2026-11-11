const STORE_KEY = 'spark-outpost.remote-client';

let known: boolean | null = null;

export function rememberRemoteClient(remote: boolean): void {
  known = remote;
  try {
    localStorage.setItem(STORE_KEY, remote ? '1' : '0');
  } catch {
    return;
  }
}

export function rememberedRemoteClient(): boolean {
  if (known !== null) return known;
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}
