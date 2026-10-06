export const PAIRING_PAGE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
      max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased;
    font: 15px/1.6 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { width: min(100%, 352px); padding: 24px 20px 20px; text-align: center;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); }
  h1 { margin: 0 0 6px; font-size: 21px; font-weight: 600; letter-spacing: -0.02em;
    line-height: 1.2; }
  p { margin: 0 0 16px; color: var(--muted); font-size: 14px; line-height: 1.5; }
  form { text-align: left; }
  form p { text-align: center; }
  label { display: block; margin: 0 0 6px; font-size: 13px; font-weight: 500; }
  input { display: block; width: 100%; margin: 0 0 14px; padding: 9px 12px; color: var(--text);
    font: inherit; font-size: 16px; line-height: 24px; background: var(--bg); outline: none;
    border: 1px solid var(--line-strong); border-radius: var(--r-sm);
    transition: border-color 0.2s, box-shadow 0.2s; }
  input::placeholder { color: var(--faint); }
  input:focus-visible { border-color: var(--accent); box-shadow: var(--focus-ring); }
  input[aria-invalid="true"] { border-color: var(--danger); }
  input[aria-invalid="true"]:focus-visible { box-shadow: var(--focus-ring-bad); }
  #code, .match { font-family: 'Geist Mono', ui-monospace, monospace; font-weight: 500; }
  #code { letter-spacing: 0.06em; }
  button { display: block; width: 100%; min-height: 44px; margin: 4px 0 0; padding: 9px 16px;
    font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
    color: var(--accent-ink); background: var(--accent); border: 0; border-radius: var(--r-sm);
    transition: transform 0.2s var(--out), opacity 0.2s, box-shadow 0.2s; }
  button:hover:not(:disabled) { box-shadow: 0 0 0 4px var(--accent-soft); }
  button:active:not(:disabled) { transform: scale(0.96); }
  button:focus-visible { outline: none;
    box-shadow: inset 0 0 0 2px var(--accent-ink), 0 0 0 1px var(--accent); }
  button:disabled { opacity: 0.35; cursor: not-allowed; }
  [hidden] { display: none; }
  .match { margin: 0 0 4px; font-size: 34px; line-height: 1.1; letter-spacing: 0.08em;
    font-variant-numeric: tabular-nums; color: var(--text); }
  #status { min-height: 20px; margin: 12px 0 0; font-size: 13px; }
  #status[data-kind="error"] { color: var(--danger); }

  .scene { display: grid; justify-items: center; width: max-content; margin: 0 auto 12px; }
  .shadow { width: 70%; height: 5px; margin-top: -3px; border-radius: 50%;
    background: color-mix(in srgb, var(--text) 10%, transparent); }
  .blob { overflow: visible; display: block; }
  .blob .hop, .blob .body, .blob .ant { transform-box: view-box; }
  .blob .body { transform-origin: 32px 58px; animation: breathe 3.4s ease-in-out infinite; }
  .blob .ant { stroke: var(--accent); transform-origin: 38px 19px; }
  .blob .skin { fill: var(--accent); }
  .blob .spark { fill: var(--warn); transform-box: fill-box; transform-origin: center;
    animation: twinkle 3s ease-in-out infinite; }
  .blob .eye { fill: var(--scout-eye); transform-box: fill-box; transform-origin: center;
    animation: blink 4.8s infinite; transition: opacity 0.2s; }
  .blob .smile { fill: none; stroke: var(--scout-eye); stroke-width: 2.8; stroke-linecap: round;
    opacity: 0; transition: opacity 0.2s; }
  .blob .cheek { fill: var(--warn); opacity: 0; transition: opacity 0.2s; }
  [data-stage="waiting"] .look { animation: scan 2.2s ease-in-out infinite; }
  [data-stage="paired"] .eye { opacity: 0; }
  [data-stage="paired"] .smile { opacity: 1; }
  [data-stage="paired"] .cheek { opacity: 0.55; }
  [data-stage="paired"] .hop { animation: hop 0.55s var(--spring) 2; }
  [data-stage="ended"] .eye { animation: none; transform: translateY(2px) scaleY(0.62); }
  [data-stage="ended"] .spark { animation: none; opacity: 0.35; }
  [data-stage="ended"] .ant { transform: rotate(18deg); }
  [data-stage="ended"] .blob { transform: rotate(-7deg); }
  @keyframes breathe { 50% { transform: scale(1.03, 0.97); } }
  @keyframes twinkle { 50% { transform: rotate(45deg) scale(0.78); opacity: 0.8; } }
  @keyframes blink { 0%, 91%, 97%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.1); } }
  @keyframes scan { 0%, 100% { transform: translate(-1.8px, -1px); } 50% { transform: translate(1.8px, -1px); } }
  @keyframes hop { 40% { transform: translateY(-6px); } }
  @media (prefers-reduced-motion: reduce) {
    .blob *, .blob { animation: none !important; }
    input, button { transition: none; }
  }
`;
