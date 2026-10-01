import { useRef, useState } from 'react';
import { pastedSecretKinds, removePastedSecrets } from '@spark-outpost/contracts';

export interface SecretGuard {
  kinds: string[] | null;
  blocks: (text: string) => boolean;
  remove: () => string;
  allow: () => void;
  dismiss: () => void;
}

export function useSecretGuard(text: string): SecretGuard {
  const [held, setHeld] = useState<{ text: string; kinds: string[] } | null>(null);
  const allowed = useRef<string | null>(null);
  const showing = held !== null && held.text === text;
  return {
    kinds: showing ? held.kinds : null,
    blocks: (outgoing) => {
      if (outgoing === allowed.current) return false;
      const kinds = pastedSecretKinds(outgoing);
      if (kinds.length === 0) return false;
      setHeld({ text: outgoing, kinds });
      return true;
    },
    remove: () => {
      setHeld(null);
      return removePastedSecrets(held?.text ?? text);
    },
    allow: () => {
      allowed.current = held?.text ?? text;
      setHeld(null);
    },
    dismiss: () => setHeld(null),
  };
}
