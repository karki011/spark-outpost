import type { SparkAction } from '@spark-outpost/contracts';
import type { SparkToolContext } from '../tool.ts';
import { performOpenPr } from './pr-action.ts';
import { performFollowUpRound } from './pr-follow-up-action.ts';
import {
  performAddMcpServer,
  performRemoveMcpServer,
  performSwitchMcpServer,
  performUpdateMcpServer,
} from './mcp-perform.ts';
import { performCreateTeammate, performUpdateTeammate } from './teammate-actions.ts';
import {
  performAssignTicket,
  performCommentTicket,
  performCreateTicket,
  performTransitionTicket,
} from './ticket-actions.ts';
import { performPostSlack } from './slack-actions.ts';
import type { Performed } from './performed.ts';

export function performSparkAction(
  context: SparkToolContext,
  action: SparkAction,
): Promise<Performed> {
  switch (action.action) {
    case 'open_pr':
      return performOpenPr(context, action);
    case 'create_ticket':
      return performCreateTicket(context, action);
    case 'comment_ticket':
      return performCommentTicket(context, action);
    case 'transition_ticket':
      return performTransitionTicket(context, action);
    case 'assign_ticket':
      return performAssignTicket(context, action);
    case 'pr_follow_up_round':
      return performFollowUpRound(context, action);
    case 'create_teammate':
      return performCreateTeammate(context, action);
    case 'update_teammate':
      return performUpdateTeammate(context, action);
    case 'add_mcp_server':
      return performAddMcpServer(context, action);
    case 'update_mcp_server':
      return performUpdateMcpServer(context, action);
    case 'switch_mcp_server':
      return performSwitchMcpServer(context, action);
    case 'remove_mcp_server':
      return performRemoveMcpServer(context, action);
    case 'post_slack':
      return performPostSlack(context, action);
    case 'pr_follow_up':
      return Promise.reject(new Error('PR feedback is pushed by the follow-up round.'));
  }
}
