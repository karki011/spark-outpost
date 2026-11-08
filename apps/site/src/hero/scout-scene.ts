import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Clock,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { onPaletteChange } from '../accent.ts';
import { onVisibility } from '../motion.ts';
import { createOrbitCards, type CardPalette } from './orbit-cards.ts';
import { createScout } from './scout-mesh.ts';

const SPARK_COUNT = 70;
const REST_AFTER_MS = 6000;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function palette(): CardPalette {
  return {
    panel: token('--panel'),
    line: token('--line-strong'),
    text: token('--text'),
    muted: token('--muted'),
    faint: token('--faint'),
    claude: token('--c-claude'),
    codex: token('--c-codex'),
    accent: token('--accent'),
  };
}

function shadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

function brand(): Color {
  return new Color(token('--brand'));
}

function floatingSparks(): Points {
  const positions: number[] = [];
  for (let index = 0; index < SPARK_COUNT; index += 1) {
    positions.push((Math.random() - 0.5) * 6, Math.random() * 4 - 1.2, (Math.random() - 0.5) * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Points(
    geometry,
    new PointsMaterial({
      size: 0.035,
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
}

function outpostBase(): Mesh<CylinderGeometry, MeshStandardMaterial> {
  return new Mesh(
    new CylinderGeometry(1.25, 1.4, 0.14, 6),
    new MeshStandardMaterial({ emissiveIntensity: 0.06, roughness: 0.5, metalness: 0.3 }),
  );
}

export interface PointerTarget {
  x: number;
  y: number;
}

export function startScoutScene(host: HTMLElement, poke: HTMLButtonElement): Promise<void> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = NeutralToneMapping;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.append(renderer.domElement);

  const scene = new Scene();
  const environment = new PMREMGenerator(renderer);
  scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
  environment.dispose();
  scene.add(new HemisphereLight(0xffffff, 0x111316, 0.6));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new DirectionalLight(0xffffff, 2.2);
  rim.position.set(-3, 1.5, -2.5);
  scene.add(rim);

  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0.55, 7);
  camera.lookAt(0, 0.25, 0);

  const scout = createScout();
  scene.add(scout.root);
  const glow = new PointLight(0xffffff, 1.2, 2.5);
  scout.star.add(glow);

  const base = outpostBase();
  base.position.y = -0.98;
  scene.add(base);
  const shadow = new Mesh(
    new PlaneGeometry(2.4, 2.4),
    new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.895;
  scene.add(shadow);

  const sparks = floatingSparks();
  scene.add(sparks);

  const fontFamily = getComputedStyle(document.body).fontFamily;
  const cards = createOrbitCards(palette(), fontFamily);
  scene.add(cards.group);

  const paint = () => {
    const color = brand();
    scout.paint(color, new Color(token('--text')));
    rim.color.copy(color);
    glow.color.copy(color);
    (sparks.material as PointsMaterial).color.copy(color);
    base.material.color.set(token('--raise'));
    base.material.emissive.copy(color);
    cards.repaint(palette());
  };
  paint();

  const pointer: PointerTarget = { x: 0, y: 0 };
  const look: PointerTarget = { x: 0, y: 0 };
  let squash = 0;
  let squashSpeed = 0;
  let hop = 0;
  let hopSpeed = 0;
  let nextBlink = 2.5;
  let narrow = false;
  let lastActive = performance.now();
  let resting = false;

  const onPointer = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    pointer.x = Math.max(-1.5, Math.min(1.5, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    pointer.y = Math.max(
      -1.5,
      Math.min(1.5, -(((event.clientY - rect.top) / rect.height) * 2 - 1)),
    );
    wake();
  };
  poke.addEventListener('click', () => {
    squashSpeed += 5.5;
    hopSpeed += 3.2;
    wake();
  });
  poke.addEventListener('focus', () => wake());

  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    narrow = width < 520;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.position.z = narrow ? 8.2 : 7;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  const clock = new Clock();
  let running = false;
  let onScreen = false;
  let firstFrame: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => (firstFrame = resolve));

  const frame = () => {
    if (!running) return;
    if (performance.now() - lastActive > REST_AFTER_MS && Math.abs(squashSpeed) < 0.01) {
      resting = true;
      sync();
      return;
    }
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    look.x += (pointer.x - look.x) * Math.min(1, delta * 6);
    look.y += (pointer.y - look.y) * Math.min(1, delta * 6);

    squashSpeed += (-60 * squash - 7 * squashSpeed) * delta;
    squash += squashSpeed * delta;
    hopSpeed -= 18 * delta;
    hop = Math.max(0, hop + hopSpeed * delta);
    if (hop === 0 && hopSpeed < 0) hopSpeed = 0;

    const bob = Math.sin(time * 1.6) * 0.06;
    scout.body.position.y = bob + hop * 0.35;
    scout.body.scale.set(1 + squash * 0.18, 1 - squash * 0.22, 1 + squash * 0.18);
    scout.body.rotation.y = look.x * 0.45;
    scout.body.rotation.x = -look.y * 0.18;
    scout.eyes.position.set(look.x * 0.07, look.y * 0.05, 0);
    scout.star.rotation.y = time * 1.4;
    scout.wobble(time, Math.min(1, Math.abs(squashSpeed) * 0.15));

    nextBlink -= delta;
    const blinkPhase = nextBlink < 0 ? Math.min(1, -nextBlink / 0.14) : 0;
    scout.blink(blinkPhase < 0.5 ? blinkPhase * 2 : (1 - blinkPhase) * 2);
    if (nextBlink < -0.14) nextBlink = 2.5 + Math.random() * 3;

    shadow.scale.setScalar(1 - (bob + hop * 0.35) * 0.4);
    sparks.rotation.y = time * 0.03;
    sparks.position.y = (time * 0.08) % 0.6;
    cards.update(time, camera, narrow ? 1.3 : 1.65);

    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame();
      firstFrame = null;
    }
    requestAnimationFrame(frame);
  };

  function sync() {
    const shouldRun = onScreen && !resting && document.visibilityState === 'visible';
    if (shouldRun === running) return;
    running = shouldRun;
    if (!running) return;
    clock.getDelta();
    requestAnimationFrame(frame);
  }
  function wake() {
    lastActive = performance.now();
    resting = false;
    sync();
  }
  onVisibility(host, (visible) => {
    onScreen = visible;
    if (visible) {
      window.addEventListener('pointermove', onPointer, { passive: true });
      wake();
    } else {
      window.removeEventListener('pointermove', onPointer);
      sync();
    }
  });
  document.addEventListener('visibilitychange', sync);
  onPaletteChange(() => {
    paint();
    wake();
  });
  return ready;
}
