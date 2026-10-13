import path from 'node:path';

export interface AppLayout {
  serverDir: string;
  webRoot: string;
  tmuxBin: string;
}

export interface LayoutSource {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  arch?: string;
}

export function appLayout(source: LayoutSource): AppLayout {
  const { isPackaged, appPath, resourcesPath, arch = process.arch } = source;
  if (isPackaged) {
    return {
      serverDir: path.join(resourcesPath, 'server'),
      webRoot: path.join(resourcesPath, 'web'),
      tmuxBin: path.join(resourcesPath, 'tmux/bin/tmux'),
    };
  }
  const repoRoot = path.resolve(appPath, '../..');
  return {
    serverDir: path.join(repoRoot, 'apps/server'),
    webRoot: path.join(repoRoot, 'apps/web/dist'),
    tmuxBin: path.join(repoRoot, '.local/tmux', arch, 'bin/tmux'),
  };
}
