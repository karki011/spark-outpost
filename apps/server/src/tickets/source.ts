import type {
  TicketPriorityName,
  TicketAssigneeFilter,
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
  doneWithinDays?: number | undefined;
}

export interface TicketSearchFilter {
  q: string;
  status?: TicketStatus | undefined;
  project?: string | undefined;
  assignee: TicketAssigneeFilter;
}

export const SEARCH_PAGE_SIZE = 50;
export const KEY_QUERY = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

export interface TransitionResult {
  moved: boolean;
  statusName: string;
  message: string | null;
}

export interface NewTicket {
  project: string;
  title: string;
  description: string;
  type: string | null;
  priority: TicketPriorityName | null;
  labels: readonly string[];
  assigneeId: string | null;
}

export interface CreatedTicket {
  key: string;
  url: string;
  skippedLabels: string[];
}

export interface TicketSource {
  id: TicketSourceId;
  whoami(): Promise<TicketAccount>;
  listAssigned(filter: TicketFilter): Promise<TicketSummary[]>;
  search(filter: TicketSearchFilter): Promise<TicketSummary[]>;
  getSummary(key: string): Promise<TicketSummary>;
  getTicket(key: string): Promise<TicketDetail>;
  assign(key: string, accountId: string | null): Promise<void>;
  transition(key: string, status: TicketStatus): Promise<TransitionResult>;
  comment(key: string, body: string): Promise<void>;
  linkPullRequest(key: string, pull: TicketRef): Promise<void>;
  create(ticket: NewTicket): Promise<CreatedTicket>;
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

export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 3_600_000);
}

export function summaryOf(ticket: TicketDetail): TicketSummary {
  return {
    source: ticket.source,
    key: ticket.key,
    title: ticket.title,
    status: ticket.status,
    statusName: ticket.statusName,
    url: ticket.url,
    updatedAt: ticket.updatedAt,
    project: ticket.project,
    priority: ticket.priority,
    sprint: ticket.sprint,
    priorityRank: ticket.priorityRank,
    assignedTo: ticket.assignedTo,
    labels: ticket.labels,
    dueDate: ticket.dueDate,
    doneAt: ticket.doneAt,
    reporter: ticket.reporter,
    createdAt: ticket.createdAt,
  };
}
