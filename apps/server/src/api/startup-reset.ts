import { followAssistantChat } from '../companion/assistant.ts';
import { moveInstructionsToFolders } from '../crew/move-instructions.ts';
import { seedModelStats } from '../model-cards/ingest.ts';
import type { Db } from '../persistence/db.ts';
import { stopAllPreviewRows } from '../persistence/preview-servers.ts';
import { forgetAllShells } from '../persistence/terminal-shells.ts';
import { acceptRulesBaseline } from '../spark-rules/rules-store.ts';

export interface StartupReset {
  db: Db;
  workspaceId: string;
  agentTerminals: { recover(): Promise<void> };
}

function moveInstructions(db: Db): Promise<void> {
  return moveInstructionsToFolders(db).then(
    ({ failed }) => {
      if (failed.length > 0) {
        console.error(`Could not move instructions for ${failed.length} Sparks`);
      }
    },
    (error: unknown) => {
      console.error("Could not move Sparks' instructions to their folders", error);
    },
  );
}

export async function resetAtStartup({ db, workspaceId, agentTerminals }: StartupReset) {
  await Promise.all([
    seedModelStats(db),
    acceptRulesBaseline().catch((error: unknown) => {
      console.error("Could not record Spark's accepted rules", error);
    }),
    moveInstructions(db),
    forgetAllShells(db, workspaceId),
    followAssistantChat(db, workspaceId).catch((error: unknown) => {
      console.error('Could not apply the Ask Spark settings', (error as Error).message);
    }),
    stopAllPreviewRows(db, workspaceId),
    agentTerminals.recover(),
  ]);
}
