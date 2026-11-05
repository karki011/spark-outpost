import { sparkTool } from '../tool.ts';
import { proposalInput, saveProposal } from './outpost-proposal.ts';

const NEXT =
  'Nothing was created and no chat was asked. The user reviews the draft from the line in this chat, can change it, and starts it; say it is ready. Each first message runs as your text, not the user’s, under that chat’s own mode and autonomy.';

export const outpostDraftTool = sparkTool({
  name: 'spark_outpost_draft',
  title: 'Propose sub-task chats',
  needs: 'outpost_draft',
  description:
    'Propose splitting work into sub-task chats, each with its own project, branch and pull request, for work that spans repos or needs separate reviews (one change in one repo stays in this chat). Saves a draft and shows the user one line to review; it creates no chat and starts nothing until the user starts it. Use spark_outpost_start instead to start them now. Before proposing a new chat in a project, check spark_chats with that project: to give the work to a chat already working there, pass its id as chat instead of project; it gets your task as a request and keeps its own title, mode and branch. Leave dependsOn empty when a sub-task can be built and reviewed alone from the default branch (parallel PRs). Set it when the sub-task needs the other’s code or edits the same files: same repo → its branch and PR stack on that one; other repo → it only starts after. Refuses rings, unknown handles or projects, and a mode above your own.',
  input: proposalInput,
  run: async (args, context) => {
    const { draft, lines } = await saveProposal(context, args);
    return { draft: draft.id, chats: lines, next: NEXT };
  },
});
