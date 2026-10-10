export function seedIndex(seed: string, size: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return size > 0 ? (hash >>> 0) % size : 0;
}
