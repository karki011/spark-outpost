import { useIsPresent } from 'motion/react';
import type { ReactNode } from 'react';

export function ExitingInert({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  return (
    <div inert={!present} aria-hidden={present ? undefined : true}>
      {children}
    </div>
  );
}
