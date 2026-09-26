export interface Signup {
  name: string;
  email: string;
}

export function parseSignup(input: unknown): Signup {
  if (typeof input !== 'object' || input === null) throw new Error('Expected an object.');
  const { name, email } = input as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') throw new Error('Name is required.');
  if (typeof email !== 'string' || !email.includes('@')) throw new Error('Email is invalid.');
  return { name: name.trim(), email: email.trim() };
}
