import { useQuery } from '@tanstack/react-query';
import { chatPortsKey, fetchChatPorts } from '../../api/chat-ports.ts';
import { queuePaneUrl } from '../../browser/pending-pane-url.ts';
import { GlobeIcon } from '../../ui/icons.tsx';

const NONE: readonly number[] = [];

function portUrl(port: number): string {
  return `http://localhost:${port}/`;
}

function useChatPorts(chatId: string): readonly number[] {
  const ports = useQuery({
    queryKey: chatPortsKey,
    queryFn: fetchChatPorts,
    select: (data) => data.ports[chatId] ?? NONE,
  });
  return ports.data ?? NONE;
}

export function RailPorts({ chatId }: { chatId: string }) {
  const ports = useChatPorts(chatId);
  if (ports.length === 0) return null;
  return (
    <ul className="crail-rows crail-ports" aria-label="Listening ports">
      {ports.map((port) => (
        <li key={port}>
          <button
            type="button"
            className="crail-row"
            aria-label={`Open localhost:${port} in the Browser pane`}
            onClick={() => queuePaneUrl(chatId, portUrl(port))}
          >
            <span className="crail-ico" aria-hidden="true">
              <GlobeIcon />
            </span>
            <span className="crail-text">
              <span className="crail-main">localhost:{port}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
