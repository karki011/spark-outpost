import { setupStateFor } from '../remote/redaction.ts';
import { isRemote } from '../remote/principal.ts';
import { AgentInstructionsError } from '../setup/agent-instructions.ts';
import { Router, type Request, type Response } from 'express';
import { forgetRejectedModels } from '../model-access/store.ts';
import {
  advisorIdSchema,
  connectableIdSchema,
  providerIdSchema,
  updateProfileRequestSchema,
  updateProviderDefaultsRequestSchema,
  verifyRequestSchema,
  type ConnectableId,
  type ProviderConnection,
  type AdvisorConnection,
  type ProviderId,
  type VerifyEvent,
  type VerifyRequest,
} from '@spark-outpost/contracts';
import { disconnectAdvisor, saveAdvisorConnection } from '../persistence/advisors.ts';
import type { Db } from '../persistence/db.ts';
import {
  activeConnection,
  disconnectProvider,
  recordTest,
  getSetupState,
  saveConnection,
  updateProfile,
} from '../persistence/setup.ts';
import { updateProviderDefaults } from '../persistence/provider-defaults.ts';
import { advisorEntry, catalogEntry } from '../providers/catalog.ts';
import type { RunCommand } from '../setup/command.ts';
import { fullDiskAccessStatus } from '../setup/full-disk-access.ts';
import { KeychainWaitingError } from '../setup/keychain.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { sendTestMessage } from '../setup/test-message.ts';
import { GitInstallerError, gitStatus, openGitInstaller } from '../ship/git.ts';
import {
  verifyApiKey,
  verifyApiKeyWithCli,
  verifyCli,
  type ApiEndpoints,
  type Verification,
  type VerifiedConnection,
} from '../setup/verify.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface SetupDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  endpoints: ApiEndpoints;
  runCommand: RunCommand;
  loginShell: string | null;
  parallelBuilders?: boolean | undefined;
}

function providerParam(req: Request): ProviderId {
  const result = providerIdSchema.safeParse(req.params.provider);
  if (!result.success) throw new BadRequestError('Unknown provider.');
  return result.data;
}

function connectableParam(req: Request): ConnectableId {
  const result = connectableIdSchema.safeParse(req.params.provider);
  if (!result.success) throw new BadRequestError('Unknown provider.');
  return result.data;
}

function writeEvent(res: Response, event: VerifyEvent) {
  res.write(`${JSON.stringify(event)}\n`);
}

export function setupRoutes(deps: SetupDeps): Router {
  const { db, workspaceId, secrets } = deps;
  const router = Router();
  const setupState = async () => ({
    ...(await getSetupState(db, workspaceId)),
    parallelBuilders: deps.parallelBuilders ?? false,
  });

  router.get('/setup', async (_req, res) => {
    res.json(setupStateFor(res, await setupState()));
  });

  router.get('/setup/git', async (_req, res) => {
    res.json(await gitStatus(deps.runCommand));
  });

  router.get('/setup/full-disk-access', async (_req, res) => {
    res.json(await fullDiskAccessStatus());
  });

  router.post('/setup/git/install', async (_req, res) => {
    try {
      res.json(await openGitInstaller(deps.runCommand));
    } catch (error) {
      if (error instanceof GitInstallerError) throw new BadRequestError(error.message);
      throw error;
    }
  });

  router.patch('/profile', async (req, res) => {
    const update = parseBody(updateProfileRequestSchema, req);
    if (isRemote(res) && update.agentInstructionsFile !== undefined) {
      res.status(403).json({ error: 'Choose local instruction files on your Mac.' });
      return;
    }
    try {
      await updateProfile(db, workspaceId, update);
    } catch (error) {
      if (error instanceof AgentInstructionsError) throw new BadRequestError(error.message);
      throw error;
    }
    res.json(setupStateFor(res, await setupState()));
  });

  function startVerification(id: ConnectableId, request: VerifyRequest): Verification {
    const advisor = advisorIdSchema.safeParse(id);
    if (advisor.success) {
      if (request.method !== 'api_key') throw new BadRequestError('Jev connects with an API key.');
      return verifyApiKey(advisorEntry(advisor.data), request.apiKey, deps.endpoints);
    }
    const entry = catalogEntry(providerIdSchema.parse(id));
    if (!entry.methods.includes(request.method)) {
      throw new BadRequestError(`${entry.name} connects with an API key.`);
    }
    return request.method === 'api_key'
      ? verifyApiKeyWithCli(entry, request.apiKey, deps.endpoints, deps.runCommand, deps.loginShell)
      : verifyCli(entry, deps.runCommand, deps.loginShell);
  }

  function saveVerified(
    id: ConnectableId,
    verified: VerifiedConnection,
  ): Promise<ProviderConnection | AdvisorConnection> {
    const advisor = advisorIdSchema.safeParse(id);
    return advisor.success
      ? saveAdvisorConnection(db, workspaceId, advisor.data, verified)
      : saveConnection(db, workspaceId, providerIdSchema.parse(id), verified);
  }

  router.post('/providers/:provider/verify', async (req, res) => {
    const provider = connectableParam(req);
    const request = parseBody(verifyRequestSchema, req);
    const verification = startVerification(provider, request);

    res.status(200).set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    let outcome = await verification.next();
    while (!outcome.done) {
      writeEvent(res, outcome.value);
      outcome = await verification.next();
    }
    const verified = outcome.value;
    if (verified) {
      try {
        if (verified.secret) await secrets.set(provider, verified.secret);
        else await secrets.delete(provider);
        const connection = await saveVerified(provider, verified);
        await forgetRejectedModels(db, workspaceId, provider);
        writeEvent(res, { type: 'connected', connection });
      } catch (error) {
        if (!(error instanceof KeychainWaitingError)) throw error;
        writeEvent(res, { type: 'step_failed', label: error.message });
      }
    }
    res.end();
  });

  router.post('/providers/:provider/test', async (req, res) => {
    const provider = providerParam(req);
    const connection = await activeConnection(db, workspaceId, provider);
    if (!connection)
      throw new BadRequestError('Connect this provider before sending a test message.');
    const outcome = await sendTestMessage(provider, connection, {
      run: deps.runCommand,
      loginShell: deps.loginShell,
      endpoints: deps.endpoints,
      secrets,
    });
    await recordTest(db, workspaceId, provider, outcome);
    res.json(setupStateFor(res, await setupState()));
  });

  router.delete('/providers/:provider/connection', async (req, res) => {
    const provider = connectableParam(req);
    const advisor = advisorIdSchema.safeParse(provider);
    if (advisor.success) await disconnectAdvisor(db, workspaceId, advisor.data);
    else await disconnectProvider(db, workspaceId, providerIdSchema.parse(provider));
    await secrets.delete(provider);
    res.json(setupStateFor(res, await setupState()));
  });

  router.patch('/providers/:provider/defaults', async (req, res) => {
    const provider = providerParam(req);
    await updateProviderDefaults(
      db,
      workspaceId,
      provider,
      parseBody(updateProviderDefaultsRequestSchema, req),
    );
    res.json(setupStateFor(res, await setupState()));
  });

  return router;
}
