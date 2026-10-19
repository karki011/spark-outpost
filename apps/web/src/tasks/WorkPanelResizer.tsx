import { PanelResizer } from '../ui/PanelResizer.tsx';
import type { PanelWidthLimits } from '../ui/panel-width.ts';
import { WORK_PANEL_LIMITS } from './work-panel-state.ts';

interface WorkPanelResizerProps {
  width: number | null;
  onWidth(width: number | null): void;
  limits?: PanelWidthLimits;
}

const panelTargets = (panel: HTMLElement) => [
  panel,
  ...panel.querySelectorAll<HTMLElement>(':scope > .wp-in'),
];

export function WorkPanelResizer({
  width,
  onWidth,
  limits = WORK_PANEL_LIMITS,
}: WorkPanelResizerProps) {
  return (
    <PanelResizer
      className="wp-resize"
      label="Resize work panel"
      panelSelector=".wp"
      variable="--wp-w"
      cap="--wp-cap"
      side="left"
      limits={limits}
      width={width}
      onWidth={onWidth}
      targets={panelTargets}
    />
  );
}
