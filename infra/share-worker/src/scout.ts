export type ScoutPose = 'asleep' | 'no' | 'sulk' | 'happy';

export const SCOUT_ANTENNA = 'M38 18C39 13 42 10 46 9';
export const SCOUT_SPARK =
  'M48 2.4Q48.9 2.4 49.5 3L53.5 7Q54.6 8.5 53.5 10L49.5 14Q48 15.1 46.5 14L42.5 10Q41.4 8.5 42.5 7L46.5 3Q47.1 2.4 48 2.4Z';
export const SCOUT_BODY =
  'M11 40C11 25 18 17 32 17C46 17 53 25 53 40C53 56 51 58 32 58C13 58 11 56 11 40Z';

const SHUT_PATH = 'M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11';
const OPEN_PATH = 'M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2';

const AWAKE = ['#code:focus', '#code:not(:placeholder-shown)']
  .map((field) => `.lock:has(${field}) .scout:not([data-pose='sulk'])`)
  .join(',\n');

export const SCOUT_CSS = `
.scout {
  --face: var(--accent-ink, var(--card));
  --eyes: 1;
  --sleep: 0;
  --spark: 1;
  --breath: 3.4s;
  --droop: 0deg;
  --squint: none;
  --blink: sc-blink;
  --twinkle: sc-twinkle;
  --wake: none;
  position: relative;
  width: 128px;
  height: 128px;
  margin: 0 auto 14px;
}
.scout[data-pose='asleep'] { --eyes: 0; --sleep: 1; --spark: 0.4; --breath: 5.2s; --blink: none; --twinkle: none; }
.scout[data-pose='no'], .scout[data-pose='sulk'] {
  --spark: 0.35; --droop: 18deg; --squint: translateY(2px) scaleY(0.62); --blink: none; --twinkle: none;
}
.scout[data-pose='happy'] { --eyes: 0; --blink: none; }
${AWAKE} {
  --eyes: 1; --sleep: 0; --spark: 1; --breath: 3.4s; --droop: 0deg; --squint: none;
  --blink: sc-blink; --twinkle: sc-twinkle; --wake: sc-wake;
}
.scout-turn { position: relative; display: block; width: 100%; height: 100%; }
.scout svg { display: block; overflow: visible; }
.scout-hop { animation: var(--wake) 0.26s ease-out; }
.sc-body { transform-box: view-box; transform-origin: 32px 58px; animation: sc-breathe var(--breath) ease-in-out infinite; }
.sc-skin { fill: var(--accent); }
.sc-ant {
  fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round;
  transform-box: view-box; transform-origin: 38px 19px; transform: rotate(var(--droop)); transition: transform 0.2s;
}
.sc-spark-fade { opacity: var(--spark); transition: opacity 0.2s; }
.sc-spark {
  fill: color-mix(in srgb, var(--accent) 55%, var(--text));
  transform-box: fill-box; transform-origin: center; animation: var(--twinkle) 3s ease-in-out infinite;
}
.sc-eye {
  fill: var(--face); opacity: var(--eyes);
  transform-box: fill-box; transform-origin: center; transform: var(--squint);
  animation: var(--blink) 4.8s infinite; transition: opacity 0.2s;
}
.sc-eye + .sc-eye { animation-delay: 0.04s; }
.sc-sleep, .sc-happy { fill: none; stroke: var(--face); stroke-width: 2.8; stroke-linecap: round; transition: opacity 0.2s; }
.sc-sleep { opacity: var(--sleep); }
.sc-happy, .sc-cheeks { opacity: 0; }
.sc-cheeks { fill: var(--face); }
.scout[data-pose='happy'] .sc-happy { opacity: 1; }
.scout[data-pose='happy'] .sc-cheeks { opacity: 0.3; }
.scout[data-pose='happy'] .scout-hop { animation: sc-hop 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) 0.15s; }
.scout[data-pose='no'] .scout-turn { animation: sc-no 0.6s ease-in-out; }
.scout[data-pose='sulk'] .scout-turn { transform: rotate(-4deg) translateY(2px); }
.scout-tag {
  position: absolute; right: -4px; bottom: 6px;
  display: grid; place-items: center; width: 38px; height: 38px;
  border-radius: 50%; background: var(--card); color: var(--text);
  box-shadow: 0 0 0 1px var(--line), 0 0 0 4px var(--bg);
}
.scout-tag svg { grid-area: 1 / 1; width: 20px; height: 20px; }
.scout[data-pose='happy'] .scout-tag {
  color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--bg);
  animation: sc-tag-pop 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) 0.45s;
}
.tag-shut { opacity: 0; animation: sc-tag-shut 0s 0.45s backwards; }
.tag-open { animation: sc-tag-open 0s 0.45s backwards; }
@keyframes sc-breathe { 50% { transform: scale(1.03, 0.97); } }
@keyframes sc-blink { 0%, 91%, 97%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.1); } }
@keyframes sc-twinkle { 50% { transform: rotate(45deg) scale(0.78); opacity: 0.8; } }
@keyframes sc-wake { 45% { transform: translateY(-7px); } }
@keyframes sc-hop { 40% { transform: translateY(-9px); } }
@keyframes sc-no {
  15%, 55% { transform: translateX(-7px) rotate(-7deg); }
  35%, 75% { transform: translateX(7px) rotate(7deg); }
}
@keyframes sc-tag-pop { 40% { transform: translateY(-5px) rotate(14deg) scale(1.18); } }
@keyframes sc-tag-shut { from { opacity: 1; } }
@keyframes sc-tag-open { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .scout, .scout * { animation: none !important; transition: none !important; }
}
`;

function tagIcon(name: string, path: string): string {
  return `<svg class="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="${path}"/></svg>`;
}

export function scout(pose: ScoutPose): string {
  const tag =
    pose === 'happy'
      ? tagIcon('tag-shut', SHUT_PATH) + tagIcon('tag-open', OPEN_PATH)
      : tagIcon('tag-lock', SHUT_PATH);
  return `<div class="scout" data-pose="${pose}" aria-hidden="true">
<div class="scout-turn">
<svg class="scout-hop" viewBox="0 0 64 64" width="128" height="128" focusable="false">
<g class="sc-body">
<path class="sc-ant" d="${SCOUT_ANTENNA}"/>
<g class="sc-spark-fade"><path class="sc-spark" d="${SCOUT_SPARK}"/></g>
<path class="sc-skin" d="${SCOUT_BODY}"/>
<g class="sc-cheeks"><circle cx="18.5" cy="46.5" r="2.7"/><circle cx="45.5" cy="46.5" r="2.7"/></g>
<rect class="sc-eye" x="22.5" y="32" width="5.6" height="11" rx="2.8"/>
<rect class="sc-eye" x="35.9" y="32" width="5.6" height="11" rx="2.8"/>
<path class="sc-happy" d="M22.4 40.5Q25.3 34.5 28.2 40.5M35.8 40.5Q38.7 34.5 41.6 40.5"/>
<path class="sc-sleep" d="M22.8 39.5H27.8M36.2 39.5H41.2"/>
</g>
</svg>
<span class="scout-tag">${tag}</span>
</div>
</div>`;
}
