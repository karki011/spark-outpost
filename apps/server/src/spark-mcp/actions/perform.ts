import type { SparkAction } from '@spark-outpost/contracts';
import type { SparkToolContext } from '../tool.ts';
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
import { performCalendarEdit } from './calendar-actions.ts';
import {
  performAtlassianRead,
  performConfluenceEdit,
  performJiraEdit,
} from './atlassian-perform.ts';
import type { Performed } from './performed.ts';
import { performAskSpark } from './ask-spark-perform.ts';
import { performPublishArtifact } from './artifact-actions.ts';
import { performStartOutpost } from './outpost-actions.ts';
import type { StartedBy } from '../../outposts/start-outpost.ts';

export const OPEN_PR_RETIRED =
  'Spark no longer opens pull requests from a card. Ask the agent to push the branch and open it.';

export function performSparkAction(
  context: SparkToolContext,
  action: SparkAction,
  startedBy: StartedBy = 'user',
): Promise<Performed> {
  switch (action.action) {
    case 'open_pr':
      return Promise.reject(new Error(OPEN_PR_RETIRED));
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
    case 'read_page':
      return Promise.resolve({
        message: `The agent can read ${action.origin} in this chat.`,
        url: null,
      });
    case 'open_page':
      return Promise.resolve({
        message: `The agent can open ${action.origin} in this chat.`,
        url: null,
      });
    case 'act_page':
      return Promise.resolve({
        message: `The agent can click and type on ${action.origin} in this chat.`,
        url: null,
      });
    case 'browser_sign_in':
      return Promise.resolve({
        message: `The agent can use ${action.label} on ${(action.sites ?? [action.origin]).join(', ')} in this chat.`,
        url: null,
      });
    case 'browser_handoff':
      return Promise.resolve({
        message: `You finished in the tab; the agent goes on from ${action.site}.`,
        url: null,
      });
    case 'mac_use_app':
      return Promise.resolve({
        message: `The agent can use ${action.app} in this chat.`,
        url: null,
      });
    case 'mac_act':
      return Promise.resolve({
        message: `The agent can press buttons and menus in ${action.app} in this chat.`,
        url: null,
      });
    case 'mac_press':
      return Promise.resolve({ message: `Allowed once in ${action.app}.`, url: null });
    case 'post_slack':
      return performPostSlack(context, action);
    case 'calendar_read':
      return Promise.resolve({
        message: 'The agent can read your calendar in this chat.',
        url: null,
      });
    case 'calendar_edit':
      return performCalendarEdit(context, action);
    case 'atlassian_read':
      return performAtlassianRead(action);
    case 'jira_edit':
      return performJiraEdit(context, action);
    case 'confluence_edit':
      return performConfluenceEdit(context, action);
    case 'start_outpost':
      return performStartOutpost(context, action, startedBy);
    case 'pr_follow_up':
      return Promise.reject(new Error('PR feedback is pushed by the follow-up round.'));
    case 'ask_spark':
      return performAskSpark(context, action);
    case 'publish_artifact':
      return performPublishArtifact(context, action);
  }
}
