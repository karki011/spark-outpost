import { prefersReducedMotion } from './motion.ts';

function spark(x: number, y: number, spread: number, index: number): void {
  const size = 3 + Math.random() * 5;
  const el = document.createElement('i');
  el.className = `spk${index % 3 === 0 ? ' star' : ''}${index % 4 === 1 ? ' warm' : ''}`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  const angle = Math.random() * Math.PI * 2;
  const distance = spread * (0.45 + Math.random() * 0.8);
  const animation = el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(1) rotate(0)', opacity: 1 },
      {
        transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px),calc(-50% + ${
          Math.sin(angle) * distance + 18
        }px)) scale(.2) rotate(180deg)`,
        opacity: 0,
      },
    ],
    { duration: 650 + Math.random() * 550, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
  animation.onfinish = () => el.remove();
}

export function burst(x: number, y: number, count = 16, spread = 70): void {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < count; i++) spark(x, y, spread, i);
}

export function burstAt(el: Element | null, count = 16, spread = 70): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height / 2, count, spread);
}
