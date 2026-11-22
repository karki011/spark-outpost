export async function firstAnswer<C, T>(
  connections: readonly C[],
  ask: (connection: C) => Promise<T>,
): Promise<{ connection: C; answer: T }> {
  let failure: unknown = new Error('No GitHub connection reaches this host.');
  for (const connection of connections) {
    try {
      return { connection, answer: await ask(connection) };
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
