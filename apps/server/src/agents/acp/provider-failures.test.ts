import { RequestError } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { ModelRejectedError } from '../../providers/provider.ts';
import { failureError, toProviderError } from './errors.ts';
import { classifyFailure, plainDetail } from './provider-failures.ts';

const CODEX_CHATGPT = `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}}`;
const body = (error: object, status = 400) => JSON.stringify({ type: 'error', status, error });
const kind = (text: string, extra: object = {}) =>
  classifyFailure({ text, ...extra })?.kind ?? null;

describe('a model the account cannot use', () => {
  it('matches the Codex ChatGPT-account rejection and names the model', () => {
    expect(classifyFailure({ text: CODEX_CHATGPT, category: 'request' })).toEqual({
      kind: 'model_unsupported',
      model: 'gpt-6.1-sol',
    });
    expect(
      classifyFailure({ text: `unexpected status 400 Bad Request: ${CODEX_CHATGPT}` })?.model,
    ).toBe('gpt-6.1-sol');
  });

  it('matches the OpenAI, Anthropic, Claude Code and Z.ai shapes', () => {
    const openai = body(
      {
        type: 'invalid_request_error',
        code: 'model_not_found',
        message: 'The model `gpt-9` does not exist or you do not have access to it.',
      },
      404,
    );
    expect(classifyFailure({ text: openai })).toEqual({
      kind: 'model_unsupported',
      model: 'gpt-9',
    });
    const anthropic = body({ type: 'not_found_error', message: 'model: claude-fable-9' }, 404);
    expect(classifyFailure({ text: anthropic })?.model).toBe('claude-fable-9');
    const claudeCode =
      "There's an issue with the selected model (opus[1m]). It may not exist or you may not have access to it.";
    expect(classifyFailure({ text: claudeCode })?.model).toBe('opus[1m]');
    expect(classifyFailure({ text: 'Internal error', errorKind: 'model_not_found' })).toEqual({
      kind: 'model_unsupported',
      model: null,
    });
    const zai = JSON.stringify({
      error: { code: '1211', message: 'Unknown Model, please check the model code.' },
    });
    expect(kind(zai)).toBe('model_unsupported');
  });

  it('leaves unrelated 400s and other model words alone', () => {
    const unrelated = [
      body({ type: 'invalid_request_error', message: "Unsupported parameter: 'temperature'." }),
      body({ type: 'invalid_request_error', message: 'Invalid schema for function read_file.' }),
      body({ type: 'not_found_error', message: 'The requested resource could not be found.' }, 404),
      'The model produced an invalid tool call.',
      'file not found: models/gpt-6.1-sol.md',
      JSON.stringify({ error: { code: '1210', message: 'Invalid API parameter.' } }),
    ];
    for (const text of unrelated) expect(kind(text)).toBeNull();
    expect(kind(body({ type: 'overloaded_error', message: 'The model is overloaded.' }, 529))).toBe(
      'overloaded',
    );
  });

  it('becomes a ModelRejectedError from a session failure or a JSON-RPC error', () => {
    const failed = failureError('Codex', { category: 'request', title: CODEX_CHATGPT });
    expect(failed).toBeInstanceOf(ModelRejectedError);
    expect((failed as ModelRejectedError).model).toBe('gpt-6.1-sol');
    expect(failed.message).not.toContain('{');
    expect(failed.details).toBe(CODEX_CHATGPT);
    const thrown = toProviderError(
      'Claude',
      RequestError.internalError({ errorKind: 'model_not_found' }, 'Model not found'),
      '',
    );
    expect(thrown).toBeInstanceOf(ModelRejectedError);
  });
});

describe('other common provider errors in plain words', () => {
  it('names quota, rate limit, sign-in, context and overload', () => {
    const quota = body(
      {
        type: 'insufficient_quota',
        code: 'insufficient_quota',
        message: 'You exceeded your current quota.',
      },
      429,
    );
    expect(kind(quota)).toBe('quota');
    expect(kind("You've hit your usage limit. Try again at 4pm.", { category: 'limit' })).toBe(
      'quota',
    );
    expect(kind('The Claude account has no available quota.', { category: 'limit' })).toBe('quota');
    expect(kind('Claude is temporarily rate limited.', { category: 'limit' })).toBe('rate_limited');
    expect(kind(JSON.stringify({ error: { code: '1113', message: 'Insufficient balance' } }))).toBe(
      'quota',
    );
    expect(kind(JSON.stringify({ error: { code: '1310', message: 'Weekly limit reached' } }))).toBe(
      'quota',
    );
    expect(kind(body({ type: 'rate_limit_error', message: 'Slow down.' }, 429))).toBe(
      'rate_limited',
    );
    expect(kind(JSON.stringify({ error: { code: '1302', message: 'High concurrency' } }))).toBe(
      'rate_limited',
    );
    expect(
      kind(body({ type: 'authentication_error', message: 'OAuth token has expired.' }, 401)),
    ).toBe('auth');
    for (const refresh of [
      'Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.',
      'Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.',
      'Your access token could not be refreshed. Please log out and sign in again.',
    ]) {
      expect(kind(refresh), refresh).toBe('auth');
    }
    expect(
      kind(
        body({
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          message: 'Too long.',
        }),
      ),
    ).toBe('context_too_long');
    expect(kind('prompt is too long: 1203441 tokens > 1000000 maximum')).toBe('context_too_long');
    expect(kind('Boom')).toBeNull();
  });

  it('never shows a raw JSON body as the message and keeps it in the details', () => {
    const raw = body({
      type: 'invalid_request_error',
      message: "Unsupported parameter: 'temperature'.",
    });
    const generic = failureError('Codex', { category: 'request', title: raw });
    expect(generic.message).toBe(
      "Codex stopped with an error: Unsupported parameter: 'temperature'.",
    );
    expect(generic.details).toBe(raw);
    const expired = failureError('Codex', {
      category: 'request',
      title: body({ type: 'authentication_error', message: 'Token expired.' }, 401),
    });
    expect(expired.message).toBe(
      "Codex isn't signed in any more. Open Settings, reconnect Codex, and try again.",
    );
    const long = toProviderError('Claude', new Error('API Error: prompt is too long'), '');
    expect(long.message).toBe(
      'This chat is too long for the model. Start a new chat or compact this one, then try again.',
    );
    expect(plainDetail('plain words')).toBe('plain words');
  });

  it('redacts secrets in the kept details', () => {
    const key = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv';
    const raw = body({ type: 'invalid_request_error', message: `bad key ${key}` });
    const error = failureError('Codex', { category: 'request', title: raw });
    expect(error.details).not.toContain(key);
    expect(error.message).not.toContain(key);
  });
});
