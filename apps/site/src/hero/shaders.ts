export const MAX_LANES = 5;

export const VERTEX = `
attribute float a_lane;
attribute vec4 a_rand;
attribute vec2 a_look;
uniform vec2 u_origin;
uniform vec2 u_res;
uniform vec2 u_pointer;
uniform vec2 u_ends[${MAX_LANES}];
uniform float u_hot[${MAX_LANES}];
uniform float u_lanes;
uniform float u_time;
uniform float u_grow;
uniform float u_scroll;
uniform float u_dpr;
varying float v_alpha;
varying float v_mix;

void main() {
  float depth = a_look.x;
  float pick = fract(a_rand.x * 7.13);
  vec2 pos;
  float alpha;
  float hot = 0.0;
  if (a_lane > float(${MAX_LANES}) - 0.5) {
    pos = (a_rand.zw * 0.5 + 0.5) * u_res;
    alpha = 0.04 + 0.14 * abs(sin(u_time * a_rand.y * 4.0 + a_rand.x * 6.283));
    alpha *= min(1.0, u_grow);
  } else {
    int lane = int(a_lane + 0.5);
    vec2 end = u_ends[lane];
    float rise = u_origin.y - end.y;
    vec2 c1 = vec2(u_origin.x, u_origin.y - rise * 0.75);
    vec2 c2 = vec2(end.x, end.y + rise * 0.1);
    float t = fract(a_rand.x + u_time * a_rand.y);
    float u = 1.0 - t;
    pos = u * u * u * u_origin + 3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t * end;
    pos += a_rand.zw * (5.0 + depth * 24.0) * (0.45 + 0.55 * t);
    alpha = (0.12 + (1.0 - depth) * 0.6) * smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.9, 1.0, t));
    alpha *= 1.0 - smoothstep(u_grow - 0.1, u_grow, t);
    alpha *= step(a_lane, u_lanes - 0.5);
    hot = u_hot[lane];
  }
  pos += u_pointer * (0.2 + depth) * 16.0;
  pos += a_rand.zw * u_scroll * (40.0 + depth * 260.0);
  pos.y -= u_scroll * depth * 140.0;
  v_alpha = alpha * (1.0 - u_scroll);
  v_mix = step(pick, mix(0.12, 0.78, hot));
  gl_Position = vec4((pos / u_res * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
  gl_PointSize = (1.2 + (1.0 - depth) * 3.4) * a_look.y * u_dpr;
}
`;

export const FRAGMENT = `
precision mediump float;
uniform vec3 u_base;
uniform vec3 u_accent;
varying float v_alpha;
varying float v_mix;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * v_alpha;
  gl_FragColor = vec4(mix(u_base, u_accent, v_mix) * a, a);
}
`;
