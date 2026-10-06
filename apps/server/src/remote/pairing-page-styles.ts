export const PAIRING_PAGE_STYLES = `
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--bg); color: var(--text);
    font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { width: min(22rem, calc(100vw - 2rem)); padding: 1.5rem; box-sizing: border-box;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; text-align: center; }
  p { margin: 0 0 1rem; color: var(--muted); }
  section p { text-align: center; }
  label { display: block; margin: 0 0 0.25rem; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; margin: 0 0 1rem; padding: 0.625rem 0.75rem;
    font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line-strong); border-radius: var(--r-sm); }
  button { width: 100%; padding: 0.75rem; font: inherit; font-weight: 600; cursor: pointer;
    color: var(--accent-ink); background: var(--accent); border: 0; border-radius: var(--r-sm); }
  button:disabled { opacity: 0.6; cursor: default; }
  [hidden] { display: none; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  .match { font-size: 2rem; font-weight: 700; letter-spacing: 0.08em; text-align: center;
    color: var(--text); }
  #status { min-height: 1.5rem; margin: 1rem 0 0; text-align: center; }
  #status[data-kind="error"] { color: var(--danger); }

  .scene { display: grid; justify-items: center; margin: 0 0 0.75rem; }
  .shadow { width: 3.25rem; height: 0.4rem; margin-top: -0.3rem; border-radius: 50%;
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
  [data-stage="waiting"] .look { animation: scan 2.4s ease-in-out infinite; }
  [data-stage="paired"] .eye { opacity: 0; }
  [data-stage="paired"] .smile { opacity: 1; }
  [data-stage="paired"] .cheek { opacity: 0.55; }
  [data-stage="paired"] .hop { animation: hop 0.55s cubic-bezier(0.3, 1.4, 0.5, 1) 2; }
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
  }
`;
