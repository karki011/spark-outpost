import { FRAGMENT, MAX_LANES, VERTEX } from './shaders.ts';

export type Point = [number, number];

export interface FieldLayout {
  width: number;
  height: number;
  origin: Point;
  ends: Point[];
}

export interface Field {
  layout(next: FieldLayout): void;
  heat(lane: number, hot: boolean): void;
  pointer(x: number, y: number): void;
  scroll(progress: number): void;
  restyle(): void;
  run(active: boolean): void;
}

const PER_LANE = 2200;
const DUST = 700;
const STRIDE = 7;
const STILL_TIME = 40;
const GROW_SECONDS = 2.4;

function shader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const made = gl.createShader(type);
  if (!made) return null;
  gl.shaderSource(made, source);
  gl.compileShader(made);
  return gl.getShaderParameter(made, gl.COMPILE_STATUS) ? made : null;
}

function program(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const made = gl.createProgram();
  if (!vertex || !fragment || !made) return null;
  gl.attachShader(made, vertex);
  gl.attachShader(made, fragment);
  gl.linkProgram(made);
  return gl.getProgramParameter(made, gl.LINK_STATUS) ? made : null;
}

function spreadValue(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
}

function particles(): Float32Array {
  const count = PER_LANE * MAX_LANES + DUST;
  const data = new Float32Array(count * STRIDE);
  for (let index = 0; index < count; index += 1) {
    const dust = index >= PER_LANE * MAX_LANES;
    const at = index * STRIDE;
    data[at] = dust ? MAX_LANES : Math.floor(index / PER_LANE);
    data[at + 1] = Math.random();
    data[at + 2] = 0.03 + Math.random() * 0.05;
    data[at + 3] = dust ? Math.random() * 2 - 1 : spreadValue();
    data[at + 4] = dust ? Math.random() * 2 - 1 : spreadValue();
    data[at + 5] = Math.random();
    data[at + 6] = dust ? 0.5 : 0.7 + Math.random() * 0.6;
  }
  return data;
}

function rgbOf(value: string): [number, number, number] {
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext('2d');
  if (!context) return [1, 1, 1];
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red = 255, green = 255, blue = 255] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

export function createField(canvas: HTMLCanvasElement, still: boolean): Field | null {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false });
  const linked = gl ? program(gl) : null;
  if (!gl || !linked) return null;
  gl.useProgram(linked);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, particles(), gl.STATIC_DRAW);
  const bytes = STRIDE * Float32Array.BYTES_PER_ELEMENT;
  const attribute = (name: string, size: number, offset: number) => {
    const location = gl.getAttribLocation(linked, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, bytes, offset * 4);
  };
  attribute('a_lane', 1, 0);
  attribute('a_rand', 4, 1);
  attribute('a_look', 2, 5);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(linked, name);

  const heatNow = new Float32Array(MAX_LANES);
  const heatGoal = new Float32Array(MAX_LANES);
  const pointerNow: Point = [0, 0];
  const pointerGoal: Point = [0, 0];
  let dpr = 1;
  let frame = 0;
  let started = 0;
  let active = false;

  const draw = (now: number) => {
    if (started === 0) started = now;
    const seconds = still ? STILL_TIME : (now - started) / 1000;
    for (let lane = 0; lane < MAX_LANES; lane += 1) {
      const goal = heatGoal[lane] ?? 0;
      const current = heatNow[lane] ?? 0;
      heatNow[lane] = still ? goal : current + (goal - current) * 0.06;
    }
    pointerNow[0] += (pointerGoal[0] - pointerNow[0]) * 0.06;
    pointerNow[1] += (pointerGoal[1] - pointerNow[1]) * 0.06;
    gl.uniform1f(uniform('u_time'), seconds);
    gl.uniform1f(uniform('u_grow'), still ? 1.2 : Math.min(1.2, (seconds / GROW_SECONDS) * 1.2));
    gl.uniform1fv(uniform('u_hot'), heatNow);
    gl.uniform2f(uniform('u_pointer'), pointerNow[0], pointerNow[1]);
    gl.uniform1f(uniform('u_dpr'), dpr);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, PER_LANE * MAX_LANES + DUST);
  };

  const loop = (now: number) => {
    draw(now);
    frame = active && !still ? requestAnimationFrame(loop) : 0;
  };

  const request = () => {
    if (frame === 0) frame = requestAnimationFrame(loop);
  };

  const restyle = () => {
    const styles = getComputedStyle(canvas);
    gl.uniform3fv(uniform('u_base'), rgbOf(styles.getPropertyValue('--text')));
    gl.uniform3fv(uniform('u_accent'), rgbOf(styles.getPropertyValue('--brand')));
    request();
  };

  restyle();
  gl.uniform1f(uniform('u_scroll'), 0);

  return {
    layout(next) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(next.width * dpr);
      canvas.height = Math.round(next.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const ends = new Float32Array(MAX_LANES * 2);
      next.ends.slice(0, MAX_LANES).forEach(([x, y], lane) => ends.set([x, y], lane * 2));
      gl.uniform2fv(uniform('u_ends'), ends);
      gl.uniform2f(uniform('u_origin'), next.origin[0], next.origin[1]);
      gl.uniform2f(uniform('u_res'), next.width, next.height);
      gl.uniform1f(uniform('u_lanes'), Math.min(MAX_LANES, next.ends.length));
      request();
    },
    heat(lane, hot) {
      heatGoal[lane] = hot ? 1 : 0;
      request();
    },
    pointer(x, y) {
      pointerGoal[0] = x;
      pointerGoal[1] = y;
    },
    scroll(progress) {
      gl.uniform1f(uniform('u_scroll'), progress);
      request();
    },
    restyle,
    run(next) {
      active = next;
      if (active) request();
    },
  };
}
