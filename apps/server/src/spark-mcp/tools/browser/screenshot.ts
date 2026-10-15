import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BROWSER_SCREENSHOT_ACTIVITY, originAndPath } from '@spark-outpost/contracts';
import { saveAttachment } from '../../../persistence/attachments.ts';
import { insertBrowserShot, shotAnchor } from '../../../persistence/browser-screenshots.ts';
import { zaiModelFor } from '../../../agents/acp/zai.ts';
import type { Queryable } from '../../../persistence/db.ts';
import { LeaseLostError } from '../../../persistence/run-events.ts';
import { runEvents } from '../../../workflow/run-events.ts';
import { renderResult } from '../../format.ts';
import { SparkBlocks, sparkTool, type SparkBlock, type SparkToolContext } from '../../tool.ts';
import { asToolError, auditBrowser, browserSession, tabInput } from './context.ts';
import { runShotDir } from './end-run.ts';
import { clearPage } from './read-flow.ts';
import { signInScrub } from './scrub.ts';
import { allowedNote } from '../allowed-note.ts';

export function takesImageResults(provider: string | null, model: string | null): boolean {
  if (provider === 'claude' || provider === 'codex') return true;
  return provider === 'zai' && (zaiModelFor(model ?? 'default')?.readsImages ?? false);
}

interface RunModel {
  provider: string | null;
  model: string | null;
}

async function runModel(db: Queryable, runId: string | null): Promise<RunModel> {
  if (!runId) return { provider: null, model: null };
  const { rows } = await db.query<RunModel>('SELECT provider, model FROM runs WHERE id = $1', [
    runId,
  ]);
  return rows[0] ?? { provider: null, model: null };
}

function shotName(now: Date, mediaType: string): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `browser-${stamp}.${mediaType === 'image/jpeg' ? 'jpg' : 'png'}`;
}

interface ShotArgs {
  tab?: string | undefined;
  ref?: string | undefined;
  fullPage: boolean;
}

async function screenshot(args: ShotArgs, context: SparkToolContext) {
  const session = browserSession(context);
  const { deps, scope } = context;
  const shot = await session.host
    .request(
      { op: 'screenshot', chatId: session.chatId, runId: session.runId, ...args },
      context.signal,
    )
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const cleared = await clearPage(context, 'spark_browser_screenshot', 'screenshot', shot, false);
  if (!cleared.cleared) return cleared.result;
  const hidden = await signInScrub(context);
  const seen = hidden ? { url: hidden(shot.url), title: hidden(shot.title) } : shot;
  const data = Buffer.from(shot.data, 'base64');
  const sha256 = createHash('sha256').update(data).digest('hex');
  const name = shotName(deps.now?.() ?? new Date(), shot.mediaType);
  const attachment = await saveAttachment(deps.db, scope.workspaceId, {
    name,
    mediaType: shot.mediaType,
    data,
  });
  if (scope.runId) {
    const said = scope.actions?.replySoFar?.();
    const shotId = await insertBrowserShot(deps.db, {
      runId: scope.runId,
      attachment,
      page: originAndPath(seen.url),
      title: seen.title,
      width: shot.width,
      height: shot.height,
      sha256,
      anchor: said ? shotAnchor(said.shown, said.held) : null,
    });
    await scope.actions
      ?.append(
        runEvents.activity(
          `${BROWSER_SCREENSHOT_ACTIVITY}:${shotId}`,
          BROWSER_SCREENSHOT_ACTIVITY,
          {
            shotId,
            attachmentId: attachment.id,
            page: originAndPath(seen.url),
            width: shot.width,
            height: shot.height,
          },
        ),
      )
      .catch((error: unknown) => {
        if (!(error instanceof LeaseLostError)) throw error;
      });
  }
  auditBrowser(context, {
    tool: 'spark_browser_screenshot',
    action: 'screenshot',
    page: seen.url,
    place: shot.place,
    decision: cleared.decision,
    detail: {
      sha256,
      bytes: data.length,
      attachmentId: attachment.id,
      masked: shot.masked,
      ...(cleared.approvalId ? { approvalId: cleared.approvalId } : {}),
    },
  });
  const facts = {
    tab: shot.tabId,
    url: seen.url,
    title: seen.title,
    place: shot.place,
    width: shot.width,
    height: shot.height,
    maskedFields: shot.masked,
    ...allowedNote(cleared.decision),
    shownToUser: 'The screenshot is shown in the chat.',
  };
  const run = await runModel(deps.db, scope.runId);
  if (takesImageResults(run.provider, run.model)) {
    const image: SparkBlock = { type: 'image', data: shot.data, mimeType: shot.mediaType };
    return new SparkBlocks([{ type: 'text', text: renderResult(facts) }, image]);
  }
  const dir = runShotDir(deps, scope.runId ?? 'session');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  await writeFile(file, data, { mode: 0o600 });
  return {
    ...facts,
    file,
    description: `Screenshot of "${seen.title || 'untitled page'}" at ${originAndPath(seen.url)}, ${shot.width}×${shot.height} px. This model does not take images from tools; the file is kept until this turn ends. Use spark_browser_read for what the page says.`,
  };
}

export const browserScreenshotTool = sparkTool({
  name: 'spark_browser_screenshot',
  needs: 'browser',
  title: 'Screenshot a page',
  description:
    'Takes a screenshot of a Browser pane tab (the visible part, the full page, or one element by ref), at most 1280 px wide, with password and card fields painted over. The user sees it in the chat. Returns the image when the model can take one, otherwise a file path and a short description. A page on an external site the user opened follows the agent mode.',
  input: {
    tab: tabInput,
    ref: z.string().max(20).optional().describe('A ref_N from spark_browser_read to crop to.'),
    fullPage: z.boolean().default(false).describe('Capture the whole page, not just what shows.'),
  },
  run: screenshot,
});
