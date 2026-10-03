const REVOKE_AFTER_MS = 60_000;

function attachmentName(header: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(header ?? '');
  return match?.[1] ?? fallback;
}

export async function saveResponse(response: Response, fallbackName: string): Promise<string> {
  const name = attachmentName(response.headers.get('Content-Disposition'), fallbackName);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return name;
}
