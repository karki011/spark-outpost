function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7e]|["\\]/g, '_');
}

function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  return `${kind}; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeFilename(name)}`;
}
