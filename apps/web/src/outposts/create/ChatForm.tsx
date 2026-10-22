import { useEffect, useId, useRef } from 'react';
import type { Project } from '@spark-outpost/contracts';
import type { AttachmentsState } from '../../chat/attachments/use-attachments.ts';
import { recentProjects } from '../../island/ProjectMenu.tsx';
import { useAddFolder } from '../../projects/use-add-folder.tsx';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { chatPlace } from '../member-view.ts';
import type { ChatDraft, ChatKind } from './create-draft.ts';
import type { ChatView } from './create-labels.ts';
import { joinBlock, type ChatField, type ChatProblem } from './create-problems.ts';
import { AgentField } from './AgentField.tsx';
import { DependsField } from './DependsField.tsx';
import { FirstMessage } from './FirstMessage.tsx';
import { HandleInput } from './HandleInput.tsx';
import { ModeField } from './ModeField.tsx';
import { PullField } from './PullField.tsx';
import { ProblemLine } from './ProblemLine.tsx';
import { levelOf, type AfterChoice } from './story-draft.ts';
import type { CreateData } from './use-create-data.ts';

export interface ChatFormActions {
  onKind: (kind: ChatKind) => void;
  onPick: (chatId: string) => void;
  onProject: (projectId: string) => void;
  onAddedProject: (project: Project) => void;
  onPatch: (changes: Partial<ChatDraft>) => void;
  onHandle: (typed: string) => void;
  onDone: () => void;
  onRemove: () => void;
}

interface ChatFormProps extends ChatFormActions {
  chat: ChatDraft;
  number: number;
  view: ChatView;
  data: CreateData;
  taken: ReadonlySet<string>;
  after: readonly AfterChoice[] | null;
  stackedOn: string | null;
  problems: readonly ChatProblem[];
  attachments: AttachmentsState;
  finished: boolean;
  focusOnMount: boolean;
}

const KINDS = [
  { id: 'existing', label: 'Existing chat' },
  { id: 'new', label: 'New chat' },
];
const NOTHING = '';

export function ChatForm(props: ChatFormProps) {
  const { chat, view, data, problems, attachments } = props;
  const ids = useId();
  const formRef = useRef<HTMLDivElement>(null);
  const focusOnMount = useRef(props.focusOnMount);
  const problemOf = (field: ChatField) => problems.find((problem) => problem.field === field);
  const picked = chat.kind === 'new' || chat.chatId !== null;

  useEffect(() => {
    if (!focusOnMount.current) return;
    formRef.current?.querySelector<HTMLElement>('.choice-picker button')?.focus();
  }, []);

  const chatChoices = data.chats
    .filter((candidate) => !candidate.archivedAt)
    .filter((candidate) => candidate.id === chat.chatId || !props.taken.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.title,
      description: chatPlace(candidate, data.projectNames),
      unavailableReason: joinBlock(candidate),
    }));
  const adder = useAddFolder({ onAdded: props.onAddedProject });
  const projectChoices = recentProjects(data.projects).map((project) => ({
    id: project.id,
    label: project.name,
    description: project.displayPath,
  }));

  const field = (name: ChatField) => {
    const problem = problemOf(name);
    return (
      problem && (
        <span id={`${ids}${name}`}>
          <ProblemLine problem={problem} onSuggestion={props.onHandle} />
        </span>
      )
    );
  };

  const handle = (
    <div className="field">
      <span>Handle</span>
      <HandleInput
        value={chat.handle}
        label="Handle"
        invalid={problemOf('handle') !== undefined}
        describedBy={problemOf('handle') ? `${ids}handle` : undefined}
        onChange={props.onHandle}
      />
      {field('handle')}
    </div>
  );

  const startsAfter = props.after && (
    <DependsField
      choices={props.after}
      value={chat.dependsOn}
      problem={field('after')}
      onChange={(dependsOn) => props.onPatch({ dependsOn })}
    />
  );

  return (
    <div
      ref={formRef}
      className="op-chat-form"
      role="group"
      aria-label={`Chat ${props.number}`}
      data-chat={view.faceId}
    >
      <div className="op-form-head">
        <Segmented
          ariaLabel="Existing or new chat"
          options={KINDS}
          value={chat.kind}
          onChange={(kind) => props.onKind(kind as ChatKind)}
        />
        <span className="op-form-count">Chat {props.number}</span>
      </div>
      {chat.kind === 'existing' ? (
        <div className="op-form-grid">
          <div className="field">
            <span>Chat</span>
            {chatChoices.length > 0 ? (
              <ChoicePicker
                label="Chat"
                placeholder="Choose a chat"
                choices={chatChoices}
                value={chat.chatId ?? NOTHING}
                onChange={props.onPick}
              />
            ) : (
              <p className="op-sheet-note">No other chats to add. Start a new chat instead.</p>
            )}
            {field('chat')}
          </div>
          {picked && handle}
          {picked && startsAfter}
        </div>
      ) : (
        <div className="op-form-grid">
          <div className="field">
            <span>Project</span>
            <ChoicePicker
              label="Project"
              placeholder="Choose a project"
              choices={projectChoices}
              value={chat.projectId ?? NOTHING}
              actions={adder.actions}
              onChange={props.onProject}
            />
            {adder.flow}
            {field('project')}
          </div>
          <div className="field">
            <span>Agent</span>
            <AgentField
              choice={chat}
              view={data.agentOf(chat)}
              data={data}
              invalid={problemOf('agent') !== undefined}
              describedBy={problemOf('agent') ? `${ids}agent` : undefined}
              onChange={props.onPatch}
            />
            {field('agent')}
          </div>
          <div className="field">
            <span>Permissions</span>
            <ModeField
              choice={chat}
              view={data.agentOf(chat)}
              data={data}
              hasProject={chat.projectId !== null}
              onChange={(agentMode) => props.onPatch({ agentMode })}
            />
          </div>
          {handle}
          {startsAfter}
          {props.after && (
            <PullField
              level={levelOf(chat, data.level)}
              stackedOn={props.stackedOn}
              readOnly={data.agentOf(chat)?.risk === 'read'}
              onChange={(level) => props.onPatch({ level })}
            />
          )}
        </div>
      )}
      {picked && (
        <FirstMessage
          open={chat.messageOpen}
          text={chat.text}
          handle={chat.handle}
          attachments={attachments}
          problem={problemOf('message')?.message ?? null}
          onOpen={(messageOpen) => props.onPatch({ messageOpen })}
          onText={(text) => props.onPatch({ text })}
        />
      )}
      {picked && (
        <div className="op-form-foot">
          <button type="button" className="btn sm ghost" onClick={props.onRemove}>
            {chat.added ? 'Remove' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn sm line"
            disabled={!props.finished}
            onClick={props.onDone}
          >
            {chat.added ? 'Done' : 'Add chat'}
          </button>
        </div>
      )}
    </div>
  );
}
