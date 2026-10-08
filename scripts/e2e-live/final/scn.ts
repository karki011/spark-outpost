import { dump, type Chat } from './lib.ts';
import { ctx, log, scenarioName, type Scenarios } from './scn-kit.ts';
import { pieceScenarios } from './scn-pieces.ts';
import { planAndStopScenarios } from './scn-plan-stop.ts';
import { queueScenarios } from './scn-queue.ts';

const scenarios: Scenarios = { ...pieceScenarios, ...queueScenarios, ...planAndStopScenarios };

const run = scenarios[scenarioName];
if (!run) throw new Error(`Unknown scenario ${scenarioName}.`);
let chat: Chat | null = null;
try {
  chat = await run();
} catch (error) {
  log.mark(`ERROR ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (chat)
    await dump(ctx, chat, log).catch((error: Error) =>
      console.log(`dump failed: ${error.message}`),
    );
  await ctx.db.end();
}
