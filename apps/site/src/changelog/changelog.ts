export interface Release {
  version: string;
  notes: string[];
}

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      releases.push({ version: line.slice(3).trim(), notes: [] });
      continue;
    }
    const current = releases.at(-1);
    if (!current) continue;
    if (line.startsWith('- ')) current.notes.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && current.notes.length > 0) {
      const last = current.notes.length - 1;
      current.notes[last] = `${current.notes[last]} ${line.trim()}`;
    }
  }
  return releases.filter((release) => release.notes.length > 0);
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function noteHtml(note: string): string {
  const match = /^([^:]{1,40}):\s(.+)$/.exec(note);
  if (!match) return `<li>${inlineMarkdown(note)}</li>`;
  return `<li><span class="note-area">${inlineMarkdown(match[1]!)}</span> ${inlineMarkdown(match[2]!)}</li>`;
}

export function releasesHtml(releases: Release[]): string {
  return releases
    .map((release) => {
      const id = `v${release.version.replace(/[^0-9a-z.-]/gi, '')}`;
      return [
        `<li class="release" id="${id}">`,
        `<h2><a href="#${id}">${escapeHtml(release.version)}</a></h2>`,
        `<ul>${release.notes.map(noteHtml).join('')}</ul>`,
        '</li>',
      ].join('');
    })
    .join('\n');
}
