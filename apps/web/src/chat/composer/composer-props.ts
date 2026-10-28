import type { ReactNode } from 'react';
import type {
  AgentCommand,
  AnnotationInput,
  Attachment,
  BackgroundWait,
  BusyEnterAction,
  ChatSettings,
  ConversationUsage,
  Project,
  ProviderSetup,
  Run,
} from '@spark-outpost/contracts';
import type { AttachmentsState } from '../attachments/use-attachments.ts';
import type { QuotesState } from '../quotes/use-quotes.ts';

export interface ComposerProps {
  conversationId: string;
  repos: Project[];
  settings: ChatSettings | null;
  providers: ProviderSetup[];
  runs: Run[];
  usageTotals: ConversationUsage;
  busy: boolean;
  stopping?: boolean;
  sending: boolean;
  ready?: boolean;
  error: string | null;
  attachments: AttachmentsState;
  onSend: (
    content: string,
    attachments: Attachment[],
    annotations: AnnotationInput[],
  ) => Promise<void>;
  quotes?: QuotesState;
  onStop: () => void;
  onQueue?: ComposerProps['onSend'];
  onSendNow?: ComposerProps['onSend'];
  busyEnter?: BusyEnterAction;
  waitingOn?: number;
  waitingBackground?: BackgroundWait | null;
  notice?: string | null;
  above?: ReactNode;
  onAudit?: () => void;
  onStartFresh?: () => void;
  agentCommands?: readonly AgentCommand[];
  agentName?: string;
  autoFocus?: boolean;
  contextLead?: ReactNode;
}
