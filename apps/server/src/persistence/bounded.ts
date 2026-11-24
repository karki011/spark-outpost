type Task = () => Promise<unknown>;

type Results<Tasks extends readonly Task[]> = {
  -readonly [Index in keyof Tasks]: Awaited<ReturnType<Tasks[Index]>>;
};

export async function bounded<const Tasks extends readonly Task[]>(
  limit: number,
  tasks: Tasks,
): Promise<Results<Tasks>> {
  const results: unknown[] = new Array<unknown>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]!();
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker);
  await Promise.all(workers);
  return results as Results<Tasks>;
}
