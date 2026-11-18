import { ARTIFACT_MAX_BYTES, type ArtifactPageKind } from '@spark-outpost/contracts';

export class ShareDocumentError extends Error {}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

function svgDocument(title: string, svg: string): string {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const name = escapeHtml(title);
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${name}</title>`,
    '<style>html,body{margin:0;height:100%}body{display:grid;place-items:center}img{max-width:100%;max-height:100%}</style>',
    `</head><body><img src="${source}" alt="${name}"></body></html>`,
  ].join('');
}

export function shareDocument(kind: ArtifactPageKind, title: string, text: string): string {
  if (kind === 'markdown') {
    throw new ShareDocumentError('Markdown artifacts can’t be shared yet.');
  }
  const html = kind === 'svg' ? svgDocument(title, text) : text;
  if (Buffer.byteLength(html, 'utf8') > ARTIFACT_MAX_BYTES) {
    throw new ShareDocumentError('This image is too large to share once it is wrapped in a page.');
  }
  return html;
}
