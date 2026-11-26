const PAGE_PREFIX = 'data:text/html;charset=utf-8,';
const ABORTED = -3;
const NOT_SERVED = 404;

export function isNotLoadedPage(url: string): boolean {
  return url.startsWith(PAGE_PREFIX);
}

export function loadFailed(errorCode: number): boolean {
  return errorCode !== ABORTED;
}

export function answerFailed(httpCode: number): boolean {
  return httpCode >= 500 || httpCode === NOT_SERVED;
}

export function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function notLoadedPage(name: string, hostname: string, retryUrl: string): string {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<title>Did not load</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
main{max-width:420px;padding:32px;text-align:center}
h1{margin:0 0 8px;font-size:20px}
p{margin:0 0 20px;opacity:.75}
a{display:inline-block;min-height:28px;padding:6px 18px;border:1px solid;border-radius:8px;color:inherit;text-decoration:none;font-weight:600}
a:focus-visible{outline:3px solid Highlight;outline-offset:2px}
</style>
<main>
<h1>${escaped(name)} did not load</h1>
<p>${escaped(hostname)} is not answering. That Mac may be asleep or offline, or Remote control may be off there.</p>
<a href="${escaped(retryUrl)}" autofocus>Try again</a>
</main>
</html>`;
  return `${PAGE_PREFIX}${encodeURIComponent(html)}`;
}
