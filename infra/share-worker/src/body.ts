type BodyResult = { text: string } | { error: 'too_large' | 'invalid' };

export function mediaType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
}

export async function readLimitedText(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > maxBytes) return { error: 'too_large' };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { error: 'too_large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { error: 'invalid' };
  }
}

export async function readForm(
  request: Request,
  maxBytes: number,
): Promise<URLSearchParams | null> {
  if (mediaType(request) !== 'application/x-www-form-urlencoded') return null;
  const body = await readLimitedText(request, maxBytes);
  return 'text' in body ? new URLSearchParams(body.text) : null;
}

export function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
