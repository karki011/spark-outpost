import { useRef, useState, type DragEvent } from 'react';

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export interface DropWatch {
  onEnter?: () => void;
  onOver?: (x: number, y: number) => void;
  onLeave?: () => void;
}

export function useFileDrop(
  onFiles: (files: File[], transfer: DataTransfer) => void,
  watch: DropWatch = {},
) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  return {
    dragging,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        if (depth.current === 1) watch.onEnter?.();
        setDragging(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        watch.onOver?.(event.clientX, event.clientY);
      },
      onDragLeave: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current > 0) return;
        setDragging(false);
        watch.onLeave?.();
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        reset();
        onFiles(Array.from(event.dataTransfer.files), event.dataTransfer);
      },
    },
  };
}
