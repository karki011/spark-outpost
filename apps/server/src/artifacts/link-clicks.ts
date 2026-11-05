import { ARTIFACT_OPEN_PARAM, ARTIFACT_OPEN_PATH } from '@spark-outpost/contracts';

const LEADING_DOCTYPE = /^\s*<!doctype[^>]*>/i;

export const LINK_CLICKS =
  '<script>addEventListener("click",function(e){if(!e.isTrusted||e.defaultPrevented)return;' +
  'var a=e.target instanceof Element?e.target.closest("a[href]"):null;' +
  'if(!a||!/^https?:$/.test(a.protocol)||a.origin===location.origin)return;' +
  `e.preventDefault();location.href="${ARTIFACT_OPEN_PATH}?${ARTIFACT_OPEN_PARAM}="+encodeURIComponent(a.href)})</script>`;

export function withLinkClicks(html: string): string {
  const doctype = LEADING_DOCTYPE.exec(html)?.[0] ?? '';
  return `${doctype}${LINK_CLICKS}${html.slice(doctype.length)}`;
}
