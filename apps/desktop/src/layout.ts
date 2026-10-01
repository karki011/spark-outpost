import path from 'node:path';

export interface AppLayout {
  serverDir: string;
  webRoot: string;
}

export interface LayoutSource {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

export function appLayout({ isPackaged, appPath, resourcesPath }: LayoutSource): AppLayout {
  if (isPackaged) {
    return {
      serverDir: path.join(resourcesPath, 'server'),
      webRoot: path.join(resourcesPath, 'web'),
    };
  }
  const repoRoot = path.resolve(appPath, '../..');
  return {
    serverDir: path.join(repoRoot, 'apps/server'),
    webRoot: path.join(repoRoot, 'apps/web/dist'),
  };
}
