export interface ReplyEnd {
  commands: number;
  terminals: number;
}

export interface ReplyStream {
  text: string;
  replyId: string | null;
  publishText: string;
  publishId: string | null;
  replyEnd: ReplyEnd | null;
}

export const initialReplyStream: ReplyStream = {
  text: '',
  replyId: null,
  publishText: '',
  publishId: null,
  replyEnd: null,
};

export function withTextDelta<State extends ReplyStream>(
  state: State,
  messageId: string,
  delta: string,
): State {
  if (state.replyId === null || state.replyId === messageId) {
    return { ...state, replyId: messageId, text: state.text + delta };
  }
  const gap = state.publishId !== null && state.publishId !== messageId ? '\n\n' : '';
  return { ...state, publishId: messageId, publishText: state.publishText + gap + delta };
}

export function withTextEnd<State extends ReplyStream>(
  state: State,
  messageId: string,
  started: ReplyEnd,
): State {
  if (state.replyId !== messageId || state.replyEnd !== null) return state;
  return { ...state, replyEnd: started };
}
