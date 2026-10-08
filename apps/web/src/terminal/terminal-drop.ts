import { sparkDesktop } from '../desktop/desktop-bridge.ts';

export function droppedPathText(files: File[], pathForFile: (file: File) => string | null): string {
  const paths = files.map((file) => {
    const path = pathForFile(file);
    if (!path?.startsWith('/'))
      throw new Error('Drop files and folders in the Mac app to insert their paths.');
    if (
      Array.from(path).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error('This path contains control characters and cannot be inserted.');
    return `'${path.replaceAll("'", "'\\''")}'`;
  });
  return paths.length ? `${paths.join(' ')} ` : '';
}

export function followTerminalDrops(
  element: HTMLElement,
  paste: (text: string) => void,
  onError: (message: string) => void,
): () => void {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const clear = () => delete element.dataset.fileDrag;
  const over = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    element.dataset.fileDrag = 'true';
  };
  element.addEventListener('dragenter', over, options);
  element.addEventListener('dragover', over, options);
  element.addEventListener(
    'dragleave',
    (event) => {
      if (event.dataTransfer?.types.includes('Files')) event.stopPropagation();
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) clear();
    },
    options,
  );
  element.addEventListener(
    'drop',
    (event) => {
      clear();
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        const text = droppedPathText(
          Array.from(event.dataTransfer.files),
          (file) => sparkDesktop()?.island.pathForFile(file) ?? null,
        );
        if (text) paste(text);
      } catch (error) {
        onError(
          error instanceof Error ? error.message : 'The dropped paths could not be inserted.',
        );
      }
    },
    options,
  );
  window.addEventListener('dragend', clear, options);
  return () => {
    abort.abort();
    clear();
  };
}
