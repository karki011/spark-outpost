const PULL_REQUEST =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?![\d])/g;

export interface PullRequestLink {
  url: string;
  title: string;
}

export function findPullRequests(text: string): PullRequestLink[] {
  const found = new Map<string, PullRequestLink>();
  for (const match of text.matchAll(PULL_REQUEST)) {
    const [, owner, repo, number] = match;
    const url = `https://github.com/${owner}/${repo}/pull/${Number(number)}`;
    if (!found.has(url)) found.set(url, { url, title: `${owner}/${repo}#${Number(number)}` });
  }
  return [...found.values()];
}
