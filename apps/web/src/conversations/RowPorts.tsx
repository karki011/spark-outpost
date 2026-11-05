import { useQuery } from '@tanstack/react-query';
import { chatPortsKey, fetchChatPorts } from '../api/chat-ports.ts';
import { GlobeIcon } from '../ui/icons.tsx';

const NONE: readonly number[] = [];

export function portUrl(port: number): string {
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

interface RowPortsProps {
  chatId: string;
  onOpenPort: (chatId: string, url: string) => void;
}

export function RowPorts({ chatId, onOpenPort }: RowPortsProps) {
  const ports = useChatPorts(chatId);
  if (ports.length === 0) return null;
  return (
    <span className="row-ports">
      {ports.map((port) => (
        <button
          key={port}
          type="button"
          className="row-port"
          aria-label={`Open localhost:${port} in the Browser pane`}
          title={`Open localhost:${port} in the Browser pane`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPort(chatId, portUrl(port));
          }}
        >
          <GlobeIcon />
          <span>:{port}</span>
        </button>
      ))}
    </span>
  );
}
