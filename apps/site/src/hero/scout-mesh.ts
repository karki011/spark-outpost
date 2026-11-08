import type { BufferAttribute } from 'three';
import {
  CapsuleGeometry,
  Color,
  CubicBezierCurve3,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';

const EYE_INK = 0x111316;
const SHEEN_LIFT = 0.5;
const WHITE = new Color(0xffffff);

export interface Scout {
  root: Group;
  body: Group;
  eyes: Group;
  star: Mesh;
  wobble: (time: number, energy: number) => void;
  blink: (amount: number) => void;
  paint: (body: Color, spark: Color) => void;
}

function shapeBlob(geometry: SphereGeometry): Float32Array {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const base = new Float32Array(position.array.length);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const flare = 1 + 0.14 * ((1 - y) / 2);
    const squashY = y < 0 ? y * 0.66 : y * 0.9;
    base[index * 3] = x * flare;
    base[index * 3 + 1] = squashY;
    base[index * 3 + 2] = z * flare * 0.86;
  }
  return base;
}

function sparkStar(): ExtrudeGeometry {
  const shape = new Shape();
  const outer = 0.2;
  const inner = 0.05;
  for (let point = 0; point < 8; point += 1) {
    const angle = (point / 8) * Math.PI * 2 + Math.PI / 2;
    const radius = point % 2 === 0 ? outer : inner;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (point === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    bevelSegments: 3,
  });
  geometry.center();
  return geometry;
}

function eye(material: MeshStandardMaterial, x: number): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(0.075, 0.15, 8, 16), material);
  mesh.position.set(x, 0.04, 0.875);
  mesh.rotation.y = x * 0.9;
  mesh.scale.z = 0.55;
  return mesh;
}

export function createScout(): Scout {
  const skin = new MeshPhysicalMaterial({
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    sheen: 0.6,
    sheenRoughness: 0.4,
  });
  const geometry = new SphereGeometry(1, 96, 64);
  const base = shapeBlob(geometry);
  const position = geometry.getAttribute('position') as BufferAttribute;
  position.array.set(base);
  geometry.computeVertexNormals();
  const blob = new Mesh(geometry, skin);

  const ink = new MeshStandardMaterial({ color: EYE_INK, roughness: 0.25, metalness: 0.1 });
  const eyes = new Group();
  eyes.add(eye(ink, -0.22), eye(ink, 0.22));

  const stalk = new Mesh(
    new TubeGeometry(
      new CubicBezierCurve3(
        new Vector3(0.12, 0.78, 0),
        new Vector3(0.16, 1.05, 0),
        new Vector3(0.3, 1.2, 0),
        new Vector3(0.48, 1.24, 0),
      ),
      24,
      0.045,
      10,
    ),
    skin,
  );
  const sparkMaterial = new MeshStandardMaterial({ emissiveIntensity: 0.9, roughness: 0.35 });
  const star = new Mesh(sparkStar(), sparkMaterial);
  star.position.set(0.6, 1.3, 0);

  const body = new Group();
  body.add(blob, eyes, stalk, star);
  const root = new Group();
  root.add(body);

  const wobble = (time: number, energy: number) => {
    const array = position.array as Float32Array;
    for (let index = 0; index < position.count; index += 1) {
      const x = base[index * 3]!;
      const y = base[index * 3 + 1]!;
      const z = base[index * 3 + 2]!;
      const wave =
        Math.sin(x * 3.1 + time * 1.7) * Math.sin(y * 2.6 + time * 1.3) * Math.sin(z * 2.9 + time);
      const swell = 1 + wave * (0.018 + energy * 0.05);
      array[index * 3] = x * swell;
      array[index * 3 + 1] = y * swell;
      array[index * 3 + 2] = z * swell;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const blink = (amount: number) => {
    for (const child of eyes.children) child.scale.y = 1 - amount * 0.9;
  };

  const paint = (bodyColor: Color, spark: Color) => {
    skin.color.copy(bodyColor);
    skin.sheenColor.copy(bodyColor).lerp(WHITE, SHEEN_LIFT);
    sparkMaterial.color.copy(spark);
    sparkMaterial.emissive.copy(spark);
  };

  return { root, body, eyes, star, wobble, blink, paint };
}
