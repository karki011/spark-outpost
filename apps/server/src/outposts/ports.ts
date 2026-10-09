import type {
  ClosedState,
  MemberRequest,
  Outpost,
  OutpostMember,
  OutpostPostKind,
  RequestFacts,
  RequestState,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { Observation } from '../persistence/observations.ts';

export type RequestAuthor =
  | { kind: 'user' }
  | {
      kind: 'chat';
      conversationId: string;
      handle: string;
      runId: string;
      startedByRequest: boolean;
    };

export interface StoredPost {
  id: string;
  outpostId: string;
  kind: OutpostPostKind;
  body: string;
  fromUser: boolean;
  fromConversationId: string | null;
  fromRunId: string | null;
  requestHash: string | null;
  waits: boolean;
  fromHandle: string | null;
  toHandle: string | null;
  toConversationId: string | null;
  guest: boolean;
  batchId: string | null;
  taskId: string | null;
  runId: string | null;
  closedState: ClosedState | null;
  closedReason: string | null;
  closedAt: string | null;
  observed: Observation[];
  answerSeenAt: string | null;
  pinnedAt: string | null;
  createdAt: string;
  attachmentIds: string[];
  opening: boolean;
}

export type NewPost = Pick<StoredPost, 'id' | 'outpostId' | 'kind' | 'body' | 'fromUser'> &
  Partial<
    Pick<
      StoredPost,
      | 'fromConversationId'
      | 'fromRunId'
      | 'requestHash'
      | 'waits'
      | 'fromHandle'
      | 'toHandle'
      | 'toConversationId'
      | 'guest'
      | 'batchId'
      | 'observed'
      | 'attachmentIds'
      | 'opening'
    >
  >;

export interface PostWithFacts {
  post: StoredPost;
  facts: RequestFacts | null;
}

export type StoredOutpost = Omit<Outpost, 'needsYou'>;

export interface OutpostStore {
  createOutpost(
    db: Queryable,
    input: { id: string; workspaceId: string; name: string; members: MemberRequest[] },
  ): Promise<StoredOutpost>;
  getOutpost(db: Queryable, workspaceId: string, id: string): Promise<StoredOutpost | null>;
  listOutposts(db: Queryable, workspaceId: string): Promise<StoredOutpost[]>;
  setName(
    db: Queryable,
    workspaceId: string,
    id: string,
    name: string,
  ): Promise<StoredOutpost | null>;
  setPaused(
    db: Queryable,
    workspaceId: string,
    id: string,
    paused: boolean,
  ): Promise<StoredOutpost | null>;
  deleteOutpost(db: Queryable, workspaceId: string, id: string): Promise<boolean>;
  addMember(db: Queryable, outpostId: string, member: MemberRequest): Promise<OutpostMember>;
  removeMember(db: Queryable, outpostId: string, conversationId: string): Promise<boolean>;
  renameHandle(
    db: Queryable,
    outpostId: string,
    conversationId: string,
    handle: string,
  ): Promise<OutpostMember | null>;
  outpostOf(
    db: Queryable,
    conversationId: string,
  ): Promise<{ outpost: StoredOutpost; member: OutpostMember } | null>;
}

export interface PostStore {
  insertPosts(db: Queryable, posts: NewPost[]): Promise<StoredPost[]>;
  listPosts(db: Queryable, outpostId: string): Promise<PostWithFacts[]>;
  getPost(db: Queryable, postId: string): Promise<PostWithFacts | null>;
  closePost(
    db: Queryable,
    postId: string,
    closed: { state: ClosedState; reason: string | null },
  ): Promise<boolean>;
  setPinned(db: Queryable, postId: string, pinned: boolean): Promise<boolean>;
  unsentRequests(db: Queryable): Promise<StoredPost[]>;
}

export interface OutboundRequest {
  postId: string;
  outpostId: string;
  toConversationId: string;
  body: string;
}

export interface TaskRef {
  taskId: string;
  conversationId: string;
}

export interface TaskView {
  taskId: string;
  state: RequestState;
  reason: string | null;
}

export interface SendOutcome {
  accepted: boolean;
  task: TaskView;
}

export interface PeerAgent {
  send(request: OutboundRequest): Promise<SendOutcome>;
  get(task: TaskRef): Promise<TaskView>;
  cancel(task: TaskRef): Promise<TaskView>;
}
