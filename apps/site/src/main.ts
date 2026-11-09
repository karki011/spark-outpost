import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import '../../web/public/theme.css';
import './styles/accent.css';
import './styles/base.css';
import './styles/hero.css';
import './styles/demos.css';
import './styles/demos-mac.css';
import './styles/demos-more.css';
import { setUpDownloads } from './download/download.ts';
import { mountBranchGraph } from './features/branch-graph.ts';
import { mountConnectors } from './features/connectors.ts';
import { mountMacControl } from './features/mac-control.ts';
import { mountMeetingDrop } from './features/meeting-drop.ts';
import { mountModes } from './features/modes.ts';
import { mountPhone } from './features/phone.ts';
import { mountPrivacy } from './features/privacy.ts';
import { mountWaterfall } from './features/waterfall.ts';
import { setUpAccentPicker } from './accent.ts';
import { setUpHero } from './hero/hero.ts';
import { reducedMotion } from './motion.ts';

const DEMOS: Record<string, (host: HTMLElement, still: boolean) => void> = {
  modes: mountModes,
  branch: mountBranchGraph,
  waterfall: mountWaterfall,
  mac: mountMacControl,
  meeting: mountMeetingDrop,
  connectors: mountConnectors,
  phone: mountPhone,
  privacy: mountPrivacy,
};

function mountDemos(): void {
  const still = reducedMotion();
  for (const host of document.querySelectorAll<HTMLElement>('[data-demo]')) {
    DEMOS[host.dataset.demo ?? '']?.(host, still);
  }
}

setUpAccentPicker();
void setUpDownloads();
setUpHero();
mountDemos();
