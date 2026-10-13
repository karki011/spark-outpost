export interface QuitPolicy {
  installing(relaunch: boolean): void;
  quittingForUpdate(): void;
  relaunching(): void;
  keepsTerminals(): boolean;
}

export function createQuitPolicy(): QuitPolicy {
  let relaunchAfterInstall = false;
  let keep = false;
  return {
    installing(relaunch) {
      relaunchAfterInstall = relaunch;
    },
    quittingForUpdate() {
      keep = relaunchAfterInstall;
    },
    relaunching() {
      keep = true;
    },
    keepsTerminals: () => keep,
  };
}
