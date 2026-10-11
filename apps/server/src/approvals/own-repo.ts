import {
  API_FIELD_FLAGS,
  apiEndpoint,
  apiMethod,
  apiWords,
  flagName,
  flagValues,
  ghPullRead,
} from './gh-reads.ts';
import { gitSubcommand, pushTargetOf } from './git-commands.ts';

export interface OwnRepo {
  host: string;
  slug: string;
  branch: string | null;
  pull: number | null;
}

const URL_WORD = /^[a-z][a-z0-9+.-]*:\/\/|^[\w.+-]+@[\w.-]+:/i;
const REPO_PLACEHOLDER = '{owner}/{repo}';
const GIT_ELSEWHERE = new Set(['-C', '--git-dir', '--work-tree']);
const GIT_FETCHES = new Set(['clone', 'fetch', 'pull', 'ls-remote']);
const GH_ELSEWHERE = /^(?:-R|--repo|--hostname)(?:=|$)/;
const REPLY_MUTATIONS = new Set([
  ...['addPullRequestReviewThreadReply', 'addPullRequestReviewComment', 'addComment'],
  ...['resolveReviewThread', 'unresolveReviewThread'],
]);
const MUTATION_CALL = /\b([A-Za-z_]\w*)\s*\(\s*input\s*:/g;
const DELETES_COMMENT = '--delete-last';
const ENV_ELSEWHERE = /\b(?:GH_HOST|GH_REPO|GIT_DIR|GIT_WORK_TREE)=/;

function isUrl(word: string): boolean {
  return URL_WORD.test(word);
}

function ownUrl(word: string, own: OwnRepo): boolean {
  const lowered = word.toLowerCase();
  const hosts = [own.host, `api.${own.host}`, `ssh.${own.host}`];
  const onHost = hosts.some(
    (host) => lowered.includes(`://${host}/`) || lowered.includes(`@${host}:`),
  );
  return onHost && new RegExp(`[/:]${escaped(own.slug)}(?:\\.git)?(?:[/?#]|$)`).test(lowered);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ownGitUse(args: readonly string[], own: OwnRepo): boolean {
  const sub = gitSubcommand(args);
  if (!sub || args.some((token) => GIT_ELSEWHERE.has(flagName(token)))) return false;
  if (GIT_FETCHES.has(sub.name)) {
    const repo = sub.rest.find((token) => !token.startsWith('-'));
    return repo !== undefined && isUrl(repo) && ownUrl(repo, own);
  }
  if (sub.name !== 'push' || !own.branch) return false;
  const target = pushTargetOf(sub.rest);
  if (target.widens || !target.remote) return false;
  if (isUrl(target.remote) && !ownUrl(target.remote, own)) return false;
  return target.branches.length > 0 && target.branches.every((name) => name === own.branch);
}

function ownSelector(word: string, own: OwnRepo): boolean {
  if (isUrl(word)) return ownUrl(word, own);
  if (word === own.branch) return true;
  return own.pull !== null && word.replace(/^#/, '') === String(own.pull);
}

function selectors(args: readonly string[]): string[] {
  return args.filter((token, index) => {
    if (token.startsWith('-')) return false;
    const previous = args[index - 1];
    return !previous || !previous.startsWith('-') || previous.includes('=');
  });
}

function namesOwnPull(args: readonly string[], own: OwnRepo): boolean {
  return selectors(args).every((word) => ownSelector(word, own));
}

function opensOwnPull(args: readonly string[], own: OwnRepo): boolean {
  if (!own.branch) return false;
  const heads = flagValues(args, new Set(['-H', '--head']));
  return heads.every((head) => head === own.branch) && namesOwnPull(args, own);
}

function onlyReplyMutations(args: readonly string[], own: OwnRepo): boolean {
  if (args.some((token) => flagName(token) === '--input')) return false;
  const text = flagValues(args, API_FIELD_FLAGS).join('\n');
  if (!/\bmutation\b/.test(text)) return false;
  const calls = [...text.matchAll(MUTATION_CALL)].map((match) => match[1]!);
  return own.pull !== null && calls.length > 0 && calls.every((name) => REPLY_MUTATIONS.has(name));
}

function ownGraphql(args: readonly string[], own: OwnRepo): boolean {
  if (args.some((token) => flagName(token) === '--input')) return false;
  const text = flagValues(args, API_FIELD_FLAGS).join('\n');
  return !/\bmutation\b/.test(text) || onlyReplyMutations(args, own);
}

function replyEndpoint(endpoint: string, own: OwnRepo): boolean {
  if (own.pull === null) return false;
  const repo = `(?:${escaped(REPO_PLACEHOLDER)}|${escaped(own.slug)})`;
  const pull = String(own.pull);
  const routes = [
    `pulls/${pull}/comments(?:/\\d+/replies)?`,
    `issues/${pull}/comments`,
    'pulls/comments/\\d+/replies',
  ];
  return new RegExp(`^/?repos/${repo}/(?:${routes.join('|')})/?$`, 'i').test(endpoint);
}

function repliesThroughApi(args: readonly string[], own: OwnRepo): boolean {
  const endpoint = apiEndpoint(args);
  if (!endpoint || isUrl(endpoint)) return false;
  if (endpoint === 'graphql') return onlyReplyMutations(args, own);
  return apiMethod(args) === 'POST' && replyEndpoint(endpoint, own);
}

function ownApi(given: readonly string[], own: OwnRepo): boolean {
  const args = apiWords(given);
  const endpoint = apiEndpoint(args);
  if (!endpoint) return false;
  if (isUrl(endpoint)) return apiMethod(args) === 'GET' && ownUrl(endpoint, own);
  if (endpoint === 'graphql') return ownGraphql(args, own);
  return apiMethod(args) === 'GET' || repliesThroughApi(args, own);
}

function commentsOnOwnPull(rest: readonly string[], own: OwnRepo): boolean {
  if (own.pull === null || rest.some((word) => isUrl(word) && !ownUrl(word, own))) return false;
  return namesOwnPull(rest, own);
}

export function ownPullReply(args: readonly string[], own: OwnRepo): boolean {
  if (args.some((token) => GH_ELSEWHERE.test(token))) return false;
  const [group, verb, ...rest] = args;
  if (group === 'api') return repliesThroughApi(apiWords(args.slice(1)), own);
  if (group !== 'pr' || verb !== 'comment' || rest.includes(DELETES_COMMENT)) return false;
  return commentsOnOwnPull(rest, own);
}

export function ownGhUse(args: readonly string[], own: OwnRepo): boolean {
  if (args.some((token) => GH_ELSEWHERE.test(token))) return false;
  const [group, verb, ...rest] = args;
  if (!group) return false;
  if (group === 'api') return ownApi(args.slice(1), own);
  if (!verb || rest.some((word) => isUrl(word) && !ownUrl(word, own))) return false;
  if (ghPullRead(group, verb)) return true;
  if (group !== 'pr') return false;
  if (verb === 'comment') return commentsOnOwnPull(rest, own);
  return (verb === 'create' || verb === 'edit') && opensOwnPull(rest, own);
}

export function namesAnotherRepo(command: string): boolean {
  return ENV_ELSEWHERE.test(command);
}
