import type {
  ClosedState,
  MemberRequest,
  Outpost,
  OutpostDraft,
  OutpostMember,
  OutpostPostKind,
  RequestFacts,
  RequestState,
  StoryPullState,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { Observation } from '../persistence/observations.ts';

export type RequestAuthor =
  | { kind: 'user' }
  | { kind: 'assistant'; runId: string }
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
  afterPostId: string | null;
  userStarted: boolean;
  agentStarted: boolean;
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
      | 'batchId'
      | 'observed'
      | 'attachmentIds'
      | 'opening'
      | 'afterPostId'
      | 'userStarted'
      | 'agentStarted'
    >
  >;

export interface PostWithFacts {
  post: StoredPost;
  facts: RequestFacts | null;
  wrapUp?: boolean;
  runError?: string;
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
  setInstructions(
    db: Queryable,
    workspaceId: string,
    id: string,
    instructions: string,
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
  heldRequests(db: Queryable): Promise<HeldRequest[]>;
  releaseHold(db: Queryable, postId: string): Promise<boolean>;
  markAnswersSeen(db: Queryable, postIds: readonly string[]): Promise<string[]>;
}

export interface HeldRequest {
  post: StoredPost;
  after: PostWithFacts;
}

export interface StoredDraft {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  runId: string | null;
  outpostId: string | null;
  title: string;
  body: OutpostDraft;
  startedAt: string | null;
  reportedAt: string | null;
  createdAt: string;
}

export type NewDraft = Pick<StoredDraft, 'id' | 'workspaceId' | 'runId' | 'outpostId' | 'body'> & {
  conversationId: string;
};

export interface DraftStore {
  saveDraft(db: Queryable, draft: NewDraft): Promise<StoredDraft>;
  getDraft(db: Queryable, workspaceId: string, id: string): Promise<StoredDraft | null>;
  markStarted(db: Queryable, id: string, outpostId: string): Promise<boolean>;
  releaseStart(
    db: Queryable,
    id: string,
    outpostId: string,
    before: string | null,
  ): Promise<boolean>;
  markReported(db: Queryable, id: string): Promise<boolean>;
  draftsOfChat(db: Queryable, workspaceId: string, conversationId: string): Promise<StoredDraft[]>;
}

export interface StoredStoryTask {
  conversationId: string;
  outpostId: string;
  draftId: string | null;
  leadConversationId: string | null;
  title: string;
  position: number;
  dependsOnConversationId: string | null;
  openingPostId: string | null;
  createdAt: string;
}

export type NewStoryTask = Omit<StoredStoryTask, 'createdAt'>;

export interface StoryPullRow {
  number: number;
  url: string;
  state: StoryPullState;
  draft: boolean;
  base: string | null;
  headSha: string | null;
}

export interface StoryTaskRow {
  task: StoredStoryTask;
  handle: string;
  storyTitle: string | null;
  leadHandle: string | null;
  projectId: string | null;
  repoRoot: string | null;
  branch: string | null;
  baseBranch: string | null;
  ownsBranch: boolean;
  pull: StoryPullRow | null;
  opening: PostWithFacts | null;
}

export interface StoryStore {
  insertTasks(db: Queryable, tasks: NewStoryTask[]): Promise<StoredStoryTask[]>;
  storiesOf(db: Queryable, outpostId: string): Promise<StoryTaskRow[]>;
  storyTaskOf(db: Queryable, conversationId: string): Promise<StoryTaskRow | null>;
  removeTask(db: Queryable, conversationId: string): Promise<boolean>;
}

export interface StackGit {
  isAncestor(repoRoot: string, ancestor: string, descendant: string): Promise<boolean>;
  branchOnRemote(repoRoot: string, branch: string): Promise<boolean>;
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
