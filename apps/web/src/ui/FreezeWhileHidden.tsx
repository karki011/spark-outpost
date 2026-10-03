import { memo, type ReactNode } from 'react';

interface FreezeWhileHiddenProps {
  hidden: boolean;
  children: ReactNode;
}

export const FreezeWhileHidden = memo(
  function FreezeWhileHidden({ children }: FreezeWhileHiddenProps) {
    return children;
  },
  (_before, after) => after.hidden,
);
