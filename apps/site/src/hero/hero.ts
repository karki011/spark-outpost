import { onVisibility } from '../motion.ts';
import { createField, type Field, type Point } from './field.ts';

const CYCLE_MS = 3800;
const WIDE = 861;

function anchors(hero: HTMLElement, cards: HTMLElement[], origin: Point): Point[] {
  const list = cards[0]?.offsetParent === hero ? null : cards[0]?.parentElement;
  const shiftX = list?.offsetLeft ?? 0;
  const shiftY = list?.offsetTop ?? 0;
  const ends = cards.map((card): Point => {
    if (card.offsetParent === null) return origin;
    return [
      shiftX + card.offsetLeft + card.offsetWidth / 2,
      shiftY + card.offsetTop + card.offsetHeight,
    ];
  });
  if (hero.clientWidth >= WIDE) ends.push([hero.clientWidth / 2, hero.clientHeight * 0.67]);
  return ends;
}

function setUpLayout(hero: HTMLElement, cards: HTMLElement[], field: Field): void {
  const measure = () => {
    const origin: Point = [hero.clientWidth / 2, hero.clientHeight + 40];
    field.layout({
      width: hero.clientWidth,
      height: hero.clientHeight,
      origin,
      ends: anchors(hero, cards, origin),
    });
  };
  new ResizeObserver(measure).observe(hero);
  measure();
}

function setUpPointer(hero: HTMLElement, field: Field | null): void {
  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const rect = hero.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    hero.style.setProperty('--px', x.toFixed(3));
    hero.style.setProperty('--py', y.toFixed(3));
    field?.pointer(x, y);
  });
}

function setUpScroll(hero: HTMLElement, field: Field | null): void {
  let frame = 0;
  const measure = () => {
    frame = 0;
    const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
    hero.style.setProperty('--p', progress.toFixed(3));
    field?.scroll(progress);
    field?.run(progress < 1 && !document.hidden);
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  measure();
}

function setUpCycles(hero: HTMLElement): void {
  const cycling = [...hero.querySelectorAll<HTMLElement>('[data-cycle]')];
  let step = 0;
  let timer = 0;
  const advance = () => {
    step += 1;
    for (const element of cycling) {
      const states = (element.dataset.cycle ?? '').split('|');
      element.textContent = states[step % states.length] ?? '';
      element.classList.remove('swap');
      void element.offsetWidth;
      element.classList.add('swap');
    }
  };
  onVisibility(hero, (visible) => {
    window.clearInterval(timer);
    if (visible) timer = window.setInterval(advance, CYCLE_MS);
  });
}

function setUpAnswers(cards: HTMLElement[], field: Field | null): void {
  for (const card of cards) {
    const ask = card.querySelector<HTMLElement>('[data-ask]');
    const answered = card.querySelector<HTMLElement>('[data-answered]');
    if (!ask || !answered) continue;
    card.addEventListener('click', (event) => {
      const answer = (event.target as HTMLElement).closest<HTMLElement>('[data-answer]');
      if (!answer) return;
      answered.textContent = answer.dataset.answer ?? '';
      ask.hidden = true;
      answered.hidden = false;
      answered.focus();
      field?.heat(Number(card.dataset.lane), false);
    });
  }
}

export function mountHero(still: boolean): void {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const canvas = hero?.querySelector<HTMLCanvasElement>('[data-field]');
  if (!hero || !canvas) return;
  const cards = [...hero.querySelectorAll<HTMLElement>('[data-lane]')];
  const field = createField(canvas, still);
  if (field) {
    setUpLayout(hero, cards, field);
    for (const card of cards) field.heat(Number(card.dataset.lane), 'hot' in card.dataset);
    document.addEventListener('spark-accent', () => field.restyle());
  }
  setUpAnswers(cards, field);
  if (still) return;
  setUpPointer(hero, field);
  setUpScroll(hero, field);
  setUpCycles(hero);
}
