export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('This run needs TEST_DATABASE_URL.');
  const test = new URL(url);
  const dev = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const sameAsDev = dev && dev.host === test.host && dev.pathname === test.pathname;
  if (sameAsDev || !/_test(_\w+)?$/.test(test.pathname)) {
    throw new Error('TEST_DATABASE_URL must name a separate *_test database, never the dev one.');
  }
  return url;
}
