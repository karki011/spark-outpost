import { useEffect, useRef } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

export function useMenuCommand(onCommand: (command: string) => void): void {
  const latest = useRef(onCommand);
  useEffect(() => {
    latest.current = onCommand;
  });
  useEffect(
    () =>
      sparkDesktop()?.menu?.onCommand((command) => {
        if (typeof command === 'string') latest.current(command);
      }),
    [],
  );
}
