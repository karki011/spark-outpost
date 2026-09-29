export async function atLeast<T>(work: Promise<T>, minimumMs: number): Promise<T> {
  const [value] = await Promise.all([
    work,
    new Promise((resolve) => setTimeout(resolve, minimumMs)),
  ]);
  return value;
}
