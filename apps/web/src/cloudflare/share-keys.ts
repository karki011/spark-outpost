export interface ShareKeys {
  uploadKey: string;
  signingKey: string;
}

function randomKey(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function newShareKeys(): ShareKeys {
  return { uploadKey: randomKey(32), signingKey: randomKey(48) };
}
