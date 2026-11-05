import { z } from 'zod';

export const readPageActionSchema = z.object({
  action: z.literal('read_page'),
  origin: z.string().max(300),
  path: z.string().max(500),
  title: z.string().max(300),
  what: z.enum(['read', 'screenshot', 'logs']),
});
export type ReadPageAction = z.infer<typeof readPageActionSchema>;

export const openPageActionSchema = z.object({
  action: z.literal('open_page'),
  origin: z.string().max(300),
  path: z.string().max(500),
});
export type OpenPageAction = z.infer<typeof openPageActionSchema>;

export const actPageActionSchema = z.object({
  action: z.literal('act_page'),
  origin: z.string().max(300),
  path: z.string().max(500),
  title: z.string().max(300),
  did: z.string().max(200),
  userTab: z.boolean(),
});
export type ActPageAction = z.infer<typeof actPageActionSchema>;

export const browserSignInActionSchema = z.object({
  action: z.literal('browser_sign_in'),
  signInId: z.uuid(),
  projectId: z.uuid(),
  label: z.string().max(60),
  origin: z.string().max(300),
  site: z.string().max(300).optional(),
  sites: z.array(z.string().max(300)).max(9).optional(),
});
export type BrowserSignInAction = z.infer<typeof browserSignInActionSchema>;

export const browserHandoffActionSchema = z.object({
  action: z.literal('browser_handoff'),
  agent: z.string().max(60),
  site: z.string().max(300),
  tabId: z.string().max(40),
});
export type BrowserHandoffAction = z.infer<typeof browserHandoffActionSchema>;

export const browserActionSchemas = [
  readPageActionSchema,
  openPageActionSchema,
  actPageActionSchema,
  browserSignInActionSchema,
  browserHandoffActionSchema,
] as const;

type BrowserAction = z.infer<(typeof browserActionSchemas)[number]>;

export const browserActionLabels: Record<
  BrowserAction['action'],
  { question: string; confirm: string; doing: string }
> = {
  read_page: {
    question: 'Let the agent read this page?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the page…',
  },
  open_page: {
    question: 'Let the agent open this site?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the site…',
  },
  act_page: {
    question: 'Let the agent click and type on this site?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the site…',
  },
  browser_sign_in: {
    question: 'Use this saved sign-in?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the sign-in…',
  },
  browser_handoff: {
    question: 'Sign in in the Browser pane',
    confirm: 'Done',
    doing: 'Handing the tab back…',
  },
};

export function browserHandoffLine(action: BrowserHandoffAction): string {
  return `${action.agent} is waiting for you to sign in to ${action.site}`;
}

export function browserQuestion(action: { action: string }): string | null {
  if (action.action === 'browser_sign_in') {
    const signIn = action as BrowserSignInAction;
    return `Sign in to ${signIn.site ?? signIn.origin} as ${signIn.label}?`;
  }
  if (action.action === 'browser_handoff')
    return browserHandoffLine(action as BrowserHandoffAction);
  return null;
}
