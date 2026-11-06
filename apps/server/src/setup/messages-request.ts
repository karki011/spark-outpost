import type { CustomKeyHeader } from '@spark-outpost/contracts';

export interface MessagesCredential {
  header: CustomKeyHeader;
  key: string;
}

function credentialHeaders(credential: MessagesCredential): Record<string, string> {
  return credential.header === 'x-api-key'
    ? { 'x-api-key': credential.key }
    : { authorization: `Bearer ${credential.key}` };
}

export function messagesRequest(
  baseUrl: string,
  credential: MessagesCredential,
  model: string,
  prompt: string,
  redirect: 'follow' | 'manual' = 'follow',
): Request {
  return new Request(`${baseUrl}/v1/messages`, {
    method: 'POST',
    redirect,
    headers: {
      ...credentialHeaders(credential),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
}
