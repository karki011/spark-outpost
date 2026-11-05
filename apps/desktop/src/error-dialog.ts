import { dialog, shell } from 'electron';

export async function showFailureDialog(
  appName: string,
  help: string | null,
  message: string,
  detail: string,
): Promise<void> {
  const buttons = help ? ['Open previous version instructions', 'Quit'] : ['OK'];
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: `${appName} could not continue`,
    message,
    detail,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
  });
  if (help && response === 0) await shell.openPath(help);
}
