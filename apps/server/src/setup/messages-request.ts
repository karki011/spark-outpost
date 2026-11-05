export function bearerMessageRequest(
  baseUrl: string,
  key: string,
  model: string,
  prompt: string,
  redirect: 'follow' | 'manual' = 'follow',
): Request {
  return new Request(`${baseUrl}/v1/messages`, {
    method: 'POST',
    redirect,
    headers: {
      authorization: `Bearer ${key}`,
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
