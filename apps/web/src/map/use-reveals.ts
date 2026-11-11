import { useMemo } from 'react';
import type { OutlineReveal } from './outline/OutlineView.tsx';
import type { Scene } from './scene.ts';
import type { SkyTargets } from './SkyView.tsx';
import type { TreeReveal } from './tree/TreeView.tsx';

export function useReveals(scene: Scene, targets: SkyTargets) {
  const { fly, area } = targets;
  const treeReveal = useMemo<TreeReveal | null>(() => {
    if (fly && (!area || fly.nonce > area.nonce)) {
      const file = scene.files[fly.file]!;
      return { area: scene.areas[file.areaIndex]!.key, file: fly.file, nonce: fly.nonce };
    }
    return area ? { area: area.key, nonce: area.nonce } : null;
  }, [fly, area, scene]);
  const outlineReveal = useMemo<OutlineReveal | null>(() => {
    if (!treeReveal) return null;
    if (treeReveal.file === undefined) return { area: treeReveal.area, nonce: treeReveal.nonce };
    const file = scene.files[treeReveal.file]!;
    return {
      area: treeReveal.area,
      file: { projectId: file.projectId, path: file.path },
      nonce: treeReveal.nonce,
    };
  }, [treeReveal, scene]);
  return { treeReveal, outlineReveal };
}
