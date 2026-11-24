import { parseSparkChatLink } from '@spark-outpost/contracts';
import { jumpTaskIn, launchChat, linkIn, type JumpTask } from './deep-link.ts';

export interface LaunchTargets {
  openChat(chatId: string): void;
  runJumpTask(task: JumpTask): void;
}

export interface LaunchRoutingOptions {
  scheme: string;
  argv: readonly string[];
  platform?: NodeJS.Platform;
  showSpark: () => void;
  slackCallback: (url: string) => void;
  isSlackCallback: (url: string) => boolean;
}

export interface LaunchRouting {
  openLink(url: string | null): void;
  secondInstance(argv: readonly string[]): void;
  ready(targets: LaunchTargets): void;
  stopped(): void;
}

export function createLaunchRouting(options: LaunchRoutingOptions): LaunchRouting {
  const platform = options.platform ?? process.platform;
  let targets: LaunchTargets | null = null;
  let pendingChat = launchChat(options.argv, options.scheme, platform);
  const pendingTasks: JumpTask[] = [];
  const launchTask = jumpTaskIn(options.argv, platform);
  if (launchTask) pendingTasks.push(launchTask);

  const runJumpTask = (task: JumpTask) => {
    if (targets) targets.runJumpTask(task);
    else pendingTasks.push(task);
  };

  const openLink = (url: string | null) => {
    if (url && options.isSlackCallback(url)) options.slackCallback(url);
    const chatId = url ? parseSparkChatLink(url, options.scheme) : null;
    if (!chatId) {
      options.showSpark();
      return;
    }
    if (targets) targets.openChat(chatId);
    else pendingChat = chatId;
  };

  return {
    openLink,
    secondInstance(argv) {
      const task = jumpTaskIn(argv, platform);
      if (task) runJumpTask(task);
      else openLink(linkIn(argv, options.scheme));
    },
    ready(next) {
      targets = next;
      if (pendingChat) next.openChat(pendingChat);
      pendingChat = null;
      for (const task of pendingTasks.splice(0)) next.runJumpTask(task);
    },
    stopped() {
      targets = null;
    },
  };
}
