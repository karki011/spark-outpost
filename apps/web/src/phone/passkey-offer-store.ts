const STORE_KEY = 'spark-outpost.passkey-offer';

export function passkeyOfferDismissed(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== null;
  } catch {
    return true;
  }
}

export function dismissPasskeyOffer(): void {
  try {
    localStorage.setItem(STORE_KEY, 'dismissed');
  } catch {
    return;
  }
}
