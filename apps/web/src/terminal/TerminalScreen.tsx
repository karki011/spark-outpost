import { useEffect, useRef } from 'react';
import { nativeTerminalApi } from './terminal-api.ts';
import { openTerminal } from './terminal-connection.ts';
import { terminalEnded } from './native-state.ts';
import { TerminalSelectionToolbar } from './selection/TerminalSelectionToolbar.tsx';
import { useTerminalSelection } from './selection/use-terminal-selection.ts';

export function TerminalScreen({
  chatId,
  attempt,
  onConnected,
  onDisconnected,
  onError,
  onInputError,
  onEnded,
}: {
  chatId: string;
  attempt: number;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onInputError: (message: string) => void;
  onEnded: () => void;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const selection = useTerminalSelection();
  const { report, attach } = selection;
  const callbacks = useRef({ onConnected, onDisconnected, onError, onInputError, onEnded });
  useEffect(() => {
    callbacks.current = { onConnected, onDisconnected, onError, onInputError, onEnded };
  });
  useEffect(() => {
    if (!screen.current) return;
    const connection = openTerminal(
      async () => {
        const session = await nativeTerminalApi.get(chatId);
        if (!session) return (await nativeTerminalApi.launch(chatId)).connection;
        if (terminalEnded(session))
          throw new Error('This session has ended. Resume it explicitly when available.');
        return nativeTerminalApi.attach(session.id);
      },
      screen.current,
      {
        preserveSession: true,
        onOpen: () => callbacks.current.onConnected(),
        onDisconnected: () => callbacks.current.onDisconnected(),
        onError: (message) => callbacks.current.onError(message),
        onInputError: (message) => callbacks.current.onInputError(message),
        onEnded: () => callbacks.current.onEnded(),
        onSelection: report,
      },
    );
    attach(connection);
    return () => {
      attach(null);
      connection.dispose();
    };
  }, [chatId, attempt, report, attach]);
  return (
    <>
      <TerminalSelectionToolbar state={selection} />
      <div
        className="native-screen term-screen"
        ref={screen}
        aria-label="Interactive agent terminal"
      />
    </>
  );
}
