export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function atLeast<T>(work: Promise<T>, ms: number): Promise<T> {
  const [outcome] = await Promise.allSettled([work, wait(ms)]);
  if (outcome.status === 'rejected') throw outcome.reason;
  return outcome.value;
}
