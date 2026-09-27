import { Router, type Request, type Response } from 'express';
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
  updateProviderDefaults,
} from '../persistence/setup.ts';
import { advisorEntry, catalogEntry } from '../providers/catalog.ts';
import type { RunCommand } from '../setup/command.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { sendTestMessage } from '../setup/test-message.ts';
import {
  verifyApiKey,
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

  router.get('/setup', async (_req, res) => {
    res.json(await getSetupState(db, workspaceId));
  });

  router.patch('/profile', async (req, res) => {
    await updateProfile(db, workspaceId, parseBody(updateProfileRequestSchema, req));
    res.json(await getSetupState(db, workspaceId));
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
      ? verifyApiKey(entry, request.apiKey, deps.endpoints)
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
      if (verified.secret) await secrets.set(provider, verified.secret);
      else await secrets.delete(provider);
      const connection = await saveVerified(provider, verified);
      writeEvent(res, { type: 'connected', connection });
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
    res.json(await getSetupState(db, workspaceId));
  });

  router.delete('/providers/:provider/connection', async (req, res) => {
    const provider = connectableParam(req);
    const advisor = advisorIdSchema.safeParse(provider);
    if (advisor.success) await disconnectAdvisor(db, workspaceId, advisor.data);
    else await disconnectProvider(db, workspaceId, providerIdSchema.parse(provider));
    await secrets.delete(provider);
    res.json(await getSetupState(db, workspaceId));
  });

  router.patch('/providers/:provider/defaults', async (req, res) => {
    const provider = providerParam(req);
    await updateProviderDefaults(
      db,
      workspaceId,
      provider,
      parseBody(updateProviderDefaultsRequestSchema, req),
    );
    res.json(await getSetupState(db, workspaceId));
  });

  return router;
}
