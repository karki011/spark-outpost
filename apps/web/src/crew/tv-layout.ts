import type { TvSize } from './agent-tv-store.ts';

export interface Seat {
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

export interface StageMetrics extends Box {
  leadSize: number;
  crewSize: number;
  labelWidth: number;
  fontSize: number;
}

export interface CrewSeat extends Seat {
  outX: number;
  outY: number;
}

export interface StageLayout {
  lead: Seat;
  seats: CrewSeat[];
  radius: number;
}

export const STAGES: Record<TvSize, StageMetrics> = {
  s: { width: 300, height: 250, leadSize: 50, crewSize: 34, labelWidth: 84, fontSize: 12 },
  m: { width: 380, height: 300, leadSize: 62, crewSize: 42, labelWidth: 96, fontSize: 12.5 },
  l: { width: 460, height: 360, leadSize: 76, crewSize: 50, labelWidth: 108, fontSize: 13 },
};

const DOCK: StageMetrics = {
  width: 200,
  height: 128,
  leadSize: 34,
  crewSize: 26,
  labelWidth: 62,
  fontSize: 11,
};
const DOCK_MAX_WIDTH = 320;
const DOCK_MAX_FONT = 13;

export function dockStage(room: number): StageMetrics {
  const width = Math.round(Math.min(Math.max(room, DOCK.width), DOCK_MAX_WIDTH));
  const scale = width / DOCK.width;
  return {
    width,
    height: Math.round(DOCK.height * scale),
    leadSize: Math.round(DOCK.leadSize * scale),
    crewSize: Math.round(DOCK.crewSize * scale),
    labelWidth: Math.round(DOCK.labelWidth * scale),
    fontSize: Math.min(DOCK_MAX_FONT, Math.round(DOCK.fontSize * scale * 2) / 2),
  };
}

const WATCH_MAX: Box = { width: 1100, height: 680 };
const WATCH_CHROME = { x: 48, y: 150 };
const MAX_SPAN = (200 * Math.PI) / 180;
const LEAD_FLOOR = 0.64;

export function watchStage(viewport: Box): StageMetrics {
  const width = Math.max(320, Math.min(WATCH_MAX.width, viewport.width - WATCH_CHROME.x));
  const height = Math.max(260, Math.min(WATCH_MAX.height, viewport.height - WATCH_CHROME.y));
  const scale = Math.min(width / STAGES.l.width, height / STAGES.l.height);
  return {
    width,
    height,
    leadSize: Math.round(Math.min(128, STAGES.l.leadSize * scale)),
    crewSize: Math.round(Math.min(84, STAGES.l.crewSize * scale)),
    labelWidth: Math.round(Math.min(150, STAGES.l.labelWidth * scale)),
    fontSize: Math.round(Math.min(15, STAGES.l.fontSize * Math.sqrt(scale)) * 2) / 2,
  };
}

function arcAngles(count: number, radius: number, gap: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [-Math.PI / 2];
  const step = 2 * Math.asin(Math.min(1, gap / (2 * radius)));
  const spacing = Math.min(step, MAX_SPAN / (count - 1));
  const start = -Math.PI / 2 - (spacing * (count - 1)) / 2;
  return Array.from({ length: count }, (_, index) => start + spacing * index);
}

export function stageLayout(count: number, stage: StageMetrics): StageLayout {
  const lead = { x: Math.round(stage.width / 2), y: Math.round(stage.height * LEAD_FLOOR) };
  const top = stage.crewSize * 0.6 + 6;
  const radius = Math.round(Math.min(stage.width / 2 - stage.labelWidth / 2, lead.y - top));
  const seats = arcAngles(count, radius, stage.labelWidth).map((angle) => {
    const outX = Math.cos(angle);
    const outY = Math.sin(angle);
    return {
      x: Math.round(lead.x + radius * outX),
      y: Math.round(lead.y + radius * outY),
      outX: Math.round(outX * 100) / 100,
      outY: Math.round(outY * 100) / 100,
    };
  });
  return { lead, seats, radius };
}

export function handoffPath(from: Seat, to: Seat, bend = 0.22): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlX = Math.round(midX - dy * bend);
  const controlY = Math.round(midY + dx * bend);
  return `M${from.x} ${from.y} Q${controlX} ${controlY} ${to.x} ${to.y}`;
}

export interface BubbleBox {
  left: number;
  width: number;
  arrow: number;
  below: boolean;
  edge: number;
}

const BUBBLE_MARGIN = 8;
const LABEL_HEIGHT = 44;

export function bubbleBox(
  anchor: Seat,
  blobSize: number,
  stage: Box,
  above = false,
  preferred = 240,
): BubbleBox {
  const width = Math.round(Math.min(preferred, stage.width - BUBBLE_MARGIN * 2));
  const left = Math.max(
    BUBBLE_MARGIN,
    Math.min(stage.width - width - BUBBLE_MARGIN, Math.round(anchor.x - width / 2)),
  );
  const below = !above && anchor.y < stage.height * 0.45;
  const edge = below
    ? Math.round(anchor.y + blobSize / 2 + LABEL_HEIGHT)
    : Math.round(stage.height - (anchor.y - blobSize / 2 - 6));
  return { left, width, arrow: Math.round(anchor.x - left), below, edge };
}

export function textWidth(text: string, fontPx = 12): number {
  return Math.ceil(text.length * fontPx * 0.54 + 26);
}

export function clampToViewport(position: Seat, size: Box, viewport: Box, margin = 8): Seat {
  return {
    x: Math.max(margin, Math.min(viewport.width - size.width - margin, position.x)),
    y: Math.max(margin, Math.min(viewport.height - size.height - margin, position.y)),
  };
}
