import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Camera,
} from 'three';

interface CardSpec {
  kind: string;
  title: string;
  detail: string;
  tint: keyof CardPalette;
}

export interface CardPalette {
  panel: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  claude: string;
  codex: string;
  accent: string;
}

const CARDS: CardSpec[] = [
  { kind: 'Chat', title: 'Fix the flaky checkout test', detail: 'Claude · Auto', tint: 'claude' },
  {
    kind: 'Branch',
    title: 'spark/fix-checkout',
    detail: '3 commits · tests pass',
    tint: 'codex',
  },
  { kind: 'Pull request', title: '#128 opened', detail: 'Never merges for you', tint: 'accent' },
];

const WIDTH = 560;
const HEIGHT = 200;

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  context.beginPath();
  context.roundRect(x, y, w, h, 34);
}

function drawCard(spec: CardSpec, palette: CardPalette, fontFamily: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d')!;
  roundedRect(context, 4, 4, WIDTH - 8, HEIGHT - 8);
  context.fillStyle = palette.panel;
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = palette.line;
  context.stroke();
  context.fillStyle = palette[spec.tint];
  context.beginPath();
  context.arc(52, 64, 14, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.muted;
  context.font = `500 30px ${fontFamily}`;
  context.fillText(spec.kind.toUpperCase(), 80, 75, WIDTH - 118);
  context.fillStyle = palette.text;
  context.font = `600 36px ${fontFamily}`;
  context.fillText(spec.title, 38, 128, WIDTH - 76);
  context.fillStyle = palette.faint;
  context.font = `400 28px ${fontFamily}`;
  context.fillText(spec.detail, 38, 168, WIDTH - 76);
  return canvas;
}

export interface OrbitCards {
  group: Group;
  update: (time: number, camera: Camera, radius: number) => void;
}

export function createOrbitCards(palette: CardPalette, fontFamily: string): OrbitCards {
  const group = new Group();
  const geometry = new PlaneGeometry(1.4, 0.5);
  const cards = CARDS.map((spec) => {
    const texture = new CanvasTexture(drawCard(spec, palette, fontFamily));
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    group.add(mesh);
    return mesh;
  });

  const update = (time: number, camera: Camera, radius: number) => {
    cards.forEach((card, index) => {
      const angle = time * 0.22 + (index * Math.PI * 2) / cards.length;
      card.position.set(
        Math.cos(angle) * radius,
        0.15 + Math.sin(angle * 2 + index) * 0.12 + Math.sin(angle) * 0.35,
        Math.sin(angle) * radius * 0.7,
      );
      card.quaternion.copy(camera.quaternion);
      const front = (Math.sin(angle) + 1) / 2;
      (card.material as MeshBasicMaterial).opacity = 0.35 + front * 0.65;
      card.scale.setScalar(0.82 + front * 0.22);
      card.renderOrder = card.position.z > 0 ? 2 : 0;
    });
  };

  return { group, update };
}
