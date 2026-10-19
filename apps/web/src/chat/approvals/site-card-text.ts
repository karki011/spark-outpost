import type { SparkAction } from '@spark-outpost/contracts';

const UNTRUSTED = 'Spark treats what the site says as untrusted.';

export function siteByline(
  action: SparkAction,
  agent: string,
  secretFiles: readonly string[] | undefined,
): string | null {
  if (action.action === 'read_page') return `${agent} wants to read a page in the browser.`;
  if (action.action === 'browser_sign_in') {
    return `${agent} asks Spark to sign in on a page in the browser.`;
  }
  if (action.action === 'browser_handoff') {
    return `${agent} handed you its browser tab to sign in to ${action.site}.`;
  }
  if (action.action === 'open_page') {
    return secretFiles
      ? `${agent} wants to open an address that holds a value from ${secretFiles.join(', ')}.`
      : `${agent} wants to open a site outside this computer in the browser.`;
  }
  if (action.action !== 'act_page') return null;
  if (secretFiles) {
    return `${agent} wants to type something that holds a value from ${secretFiles.join(', ')} into this site.`;
  }
  return action.userTab
    ? `${agent} wants to click and type on a tab you opened.`
    : `${agent} wants to click and type on a site outside this computer.`;
}

export function siteNote(
  action: SparkAction,
  secretFiles: readonly string[] | undefined,
): string | null {
  if (action.action === 'browser_sign_in') {
    return 'Spark types the saved username and password into this site, and only on the sites saved for this sign-in. The agent never sees them. Allowing covers this sign-in for the rest of this chat.';
  }
  if (action.action === 'browser_handoff') {
    return 'Sign in yourself in the Browser pane: single sign-on, a code or a passkey. The agent never sees what you type and gets the tab back, signed in, when you select Done.';
  }
  if (
    action.action !== 'read_page' &&
    action.action !== 'open_page' &&
    action.action !== 'act_page'
  ) {
    return null;
  }
  if (secretFiles) {
    return 'The site receives the value. This is allowed one time only; the card never shows the value.';
  }
  if (action.action === 'read_page') {
    return `The site is outside your project. ${UNTRUSTED} Allowing covers this site for the rest of this chat.`;
  }
  if (action.action === 'open_page') {
    return `The address the agent opens goes to that site. ${UNTRUSTED} Allowing covers opening and reading this site for the rest of this chat.`;
  }
  return action.userTab
    ? 'You may be signed in on this tab, so the agent acts as you. Allowing covers this site for the rest of this chat.'
    : `What the agent types goes to that site. ${UNTRUSTED} Allowing covers this site for the rest of this chat.`;
}
