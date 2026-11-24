type Results = readonly PromiseSettledResult<unknown>[];

type Values<T extends Results> = {
  -readonly [K in keyof T]: T[K] extends PromiseSettledResult<infer Value> ? Value : never;
};

export function fulfilled<T extends Results>(results: T): Values<T> {
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as Values<T>;
}

export async function together<T extends readonly unknown[] | []>(
  work: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  return fulfilled(await Promise.allSettled(work)) as { -readonly [K in keyof T]: Awaited<T[K]> };
}
