import './publish-result.css';
import type { AgentTerminalView } from '../commands/agent-terminal-model.ts';
import type { CommandView } from '../commands/command-model.ts';
import { TurnReply } from '../commands/TurnReply.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { RowIcon } from '../rows/RowIcon.tsx';

interface PublishResultProps {
  text: string;
  commands: readonly CommandView[];
  terminals: readonly AgentTerminalView[];
  waiting: boolean;
  streaming: boolean;
}

const NO_SHOTS = [] as const;

export function PublishResult({
  text,
  commands,
  terminals,
  waiting,
  streaming,
}: PublishResultProps) {
  if (text.trim() === '' && commands.length === 0 && terminals.length === 0) return null;
  return (
    <div className="publish-result" role="group" aria-label="Publish result">
      <RowIcon name="publish" />
      <div className="publish-body">
        <TurnReply
          text={text}
          shots={NO_SHOTS}
          commands={commands}
          terminals={terminals}
          waiting={waiting}
        >
          {(part, last) => <Markdown text={part} streaming={last && streaming} />}
        </TurnReply>
      </div>
    </div>
  );
}
