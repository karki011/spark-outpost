import type {
  TicketDetail,
  TicketRef,
  TicketSourceId,
  TicketStatus,
  TicketSummary,
} from '@spark-outpost/contracts';

export interface TicketAccount {
  id: string;
  name: string;
}

export interface TicketFilter {
  status?: TicketStatus | undefined;
  project?: string | undefined;
  q?: string | undefined;
}

export interface TransitionResult {
  moved: boolean;
  statusName: string;
  message: string | null;
}

export interface TicketSource {
  id: TicketSourceId;
  whoami(): Promise<TicketAccount>;
  listAssigned(filter: TicketFilter): Promise<TicketSummary[]>;
  getTicket(key: string): Promise<TicketDetail>;
  transition(key: string, status: TicketStatus): Promise<TransitionResult>;
  comment(key: string, body: string): Promise<void>;
  linkPullRequest(key: string, pull: TicketRef): Promise<void>;
}

export class TicketApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class TicketNotConnectedError extends Error {}

export class TicketConflictError extends Error {}

export function matchesFilter(ticket: TicketSummary, filter: TicketFilter): boolean {
  if (filter.status ? ticket.status !== filter.status : ticket.status === 'done') return false;
  if (filter.project && ticket.project?.toLowerCase() !== filter.project.toLowerCase()) {
    return false;
  }
  const q = filter.q?.toLowerCase();
  return !q || `${ticket.key} ${ticket.title}`.toLowerCase().includes(q);
}
