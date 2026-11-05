export interface Signup {
  email: string;
  password: string;
}

export function parseSignup(input: unknown): Signup {
  if (typeof input !== 'object' || input === null) throw new Error('Expected an object.');
  const { email, password } = input as Record<string, unknown>;
  if (typeof email !== 'string' || !email.includes('@')) throw new Error('Email is invalid.');
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Use at least 12 characters.');
  }
  return { email: email.trim(), password };
}
