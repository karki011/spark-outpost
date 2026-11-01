import type { WebContents } from 'electron';

export interface TabMediaHooks {
  changed(): void;
  zoomOf(url: string): number;
}

const ZOOM_EPSILON = 0.001;

export class TabMedia {
  muted = false;
  audible = false;
  private contents: WebContents | null = null;
  private readonly hooks: TabMediaHooks;

  constructor(hooks: TabMediaHooks) {
    this.hooks = hooks;
  }

  attach(contents: WebContents): void {
    this.contents = contents;
    contents.setAudioMuted(this.muted);
    contents.on('audio-state-changed', (event) => {
      this.audible = event.audible;
      this.hooks.changed();
    });
    contents.on('did-navigate', () => this.syncZoom());
  }

  detach(): void {
    this.contents = null;
    this.audible = false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const contents = this.contents;
    if (contents && !contents.isDestroyed()) contents.setAudioMuted(muted);
    this.hooks.changed();
  }

  syncZoom(): void {
    const contents = this.contents;
    if (!contents || contents.isDestroyed()) return;
    const zoom = this.hooks.zoomOf(contents.getURL());
    if (Math.abs(contents.getZoomFactor() - zoom) > ZOOM_EPSILON) contents.setZoomFactor(zoom);
  }
}
