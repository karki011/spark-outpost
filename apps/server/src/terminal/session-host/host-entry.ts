const [mode, directory] = process.argv.slice(-2);

async function main(): Promise<void> {
  if (!directory) throw new Error('Pass the session host folder.');
  if (mode === 'serve') {
    const { serveSessionHost } = await import('./host-serve.ts');
    return serveSessionHost(directory);
  }
  if (mode === 'ctl') {
    const { runCtl } = await import('./host-ctl.ts');
    await runCtl(directory);
    return process.exit(0);
  }
  throw new Error('Unknown session host mode.');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'The session host failed.'}\n`);
  process.exit(1);
});
