import { useState, type FormEvent } from 'react';
import { parseSignup, type Signup } from './signup.ts';

export function SignupForm({ onSubmit }: { onSubmit: (signup: Signup) => void }) {
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      onSubmit(parseSignup(data));
      setError(null);
    } catch (problem) {
      setError((problem as Error).message);
    }
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="signup-email">Email</label>
      <input id="signup-email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="signup-password">Password</label>
      <input
        id="signup-password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign up</button>
    </form>
  );
}
