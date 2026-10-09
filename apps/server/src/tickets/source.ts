import type {
  ReportedPullState,
  TicketBranch,
  TicketBuilds,
  TicketCommits,
  TicketPriorityName,
  TicketAssigneeFilter,
  TicketDetail,
  TicketRef,
  TicketSourceId,
  TicketStatus,
  TicketSummary,
} from '@spark-outpost/contracts';

import type { MovePlan, MoveRequest } from './move-target.ts';
import type { SourceState } from './status.ts';

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

export interface TransitionResult extends MovePlan {
  moved: boolean;
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

export interface SourcePull {
  url: string;
  title: string | null;
  state: ReportedPullState;
  branch: string | null;
  author: string | null;
  updatedAt: string | null;
  repo: string | null;
  number: number | null;
}

export interface SourceDevelopment {
  pullRequests: SourcePull[];
  branches: TicketBranch[];
  commits: TicketCommits | null;
  builds: TicketBuilds | null;
}

export interface TicketSource {
  id: TicketSourceId;
  whoami(): Promise<TicketAccount>;
  listAssigned(filter: TicketFilter): Promise<TicketSummary[]>;
  search(filter: TicketSearchFilter): Promise<TicketSummary[]>;
  getSummary(key: string): Promise<TicketSummary>;
  getTicket(key: string): Promise<TicketDetail>;
  assign(key: string, accountId: string | null): Promise<void>;
  planMove(key: string, request: MoveRequest): Promise<MovePlan>;
  transition(key: string, request: MoveRequest): Promise<TransitionResult>;
  projectStatuses(project: string): Promise<SourceState[]>;
  comment(key: string, body: string): Promise<void>;
  linkPullRequest(key: string, pull: TicketRef): Promise<void>;
  create(ticket: NewTicket): Promise<CreatedTicket>;
  development?(key: string): Promise<SourceDevelopment>;
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
