import { session, WebContentsView, type BrowserWindow } from 'electron';
import type { BrowserBox } from '@spark-outpost/contracts';
import type { PickPointer } from './pick-gesture.ts';

const PARTITION = 'spark-pick-overlay';
const ACCENT = '10,132,255';
const WHEEL_PREFIX = 'spark-wheel ';

const PAGE = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:crosshair;user-select:none}
.box{position:fixed;left:0;top:0;box-sizing:border-box;pointer-events:none;border-radius:3px}
#hl{border:2px solid rgb(${ACCENT});background:rgba(${ACCENT},.12);opacity:0;transition:transform 90ms ease-out,width 90ms ease-out,height 90ms ease-out,opacity 90ms}
#hl.on{opacity:1}
#hl.busy{animation:pulse .7s ease-in-out infinite alternate}
#band{border:1.5px solid rgb(${ACCENT});background:rgba(${ACCENT},.08);box-shadow:0 0 0 100vmax rgba(0,0,0,.28);display:none}
.mark{border:2px solid rgba(${ACCENT},.75);background:rgba(${ACCENT},.06)}
#tag{position:fixed;left:0;top:0;padding:2px 7px;border-radius:5px;background:rgb(${ACCENT});color:#fff;font:500 12px/18px -apple-system,system-ui,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transition:transform 90ms ease-out,opacity 90ms}
#tag.on{opacity:1}
@keyframes pulse{to{background:rgba(${ACCENT},.34)}}
@media (prefers-reduced-motion:reduce){#hl,#tag{transition:none}#hl.busy{animation:none;background:rgba(${ACCENT},.3)}}
</style>
<div id="band" class="box"></div><div id="hl" class="box"></div><div id="tag"></div>
<script>
const hl=document.getElementById('hl'),tag=document.getElementById('tag'),band=document.getElementById('band');
const place=(n,b)=>{n.style.transform='translate('+b.x+'px,'+b.y+'px)';n.style.width=b.width+'px';n.style.height=b.height+'px'};
window.spark={
 shift:false,
 draw(b,label){place(hl,b);hl.classList.add('on');hl.classList.remove('busy');tag.textContent=label;tag.classList.add('on');
  const h=tag.offsetHeight,w=tag.offsetWidth;const y=b.y-h-4<0?Math.min(b.y+b.height+4,innerHeight-h):b.y-h-4;
  tag.style.transform='translate('+Math.max(0,Math.min(b.x,innerWidth-w))+'px,'+Math.max(0,y)+'px)'},
 clear(){hl.classList.remove('on','busy');tag.classList.remove('on')},
 busy(){hl.classList.add('busy')},
 band(b){band.style.display='block';place(band,b);this.clear()},
 unband(){band.style.display='none'},
 mark(b){const m=document.createElement('div');m.className='box mark';place(m,b);document.body.append(m)},
 unmark(){for(const m of document.querySelectorAll('.mark'))m.remove()}
};
addEventListener('mousedown',e=>{window.spark.shift=e.shiftKey},true);
addEventListener('wheel',e=>{e.preventDefault();console.debug('spark-wheel '+JSON.stringify({x:e.clientX,y:e.clientY,deltaX:e.deltaX,deltaY:e.deltaY}))},{passive:false});
</script>`;

export interface PickKey {
  key: string;
  shift: boolean;
}

export interface PickWheel {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export interface PickSurface {
  draw(box: BrowserBox, label: string): void;
  clear(): void;
  busy(): void;
  band(box: BrowserBox): void;
  unband(): void;
  mark(box: BrowserBox): void;
  unmark(): void;
  zoom(): number;
  onPointer(listener: (pointer: PickPointer) => void): void;
  onKey(listener: (key: PickKey) => void): void;
  onWheel(listener: (wheel: PickWheel) => void): void;
  onGone(listener: () => void): void;
  close(): void;
}

export function pointerKind(type: string): PickPointer['type'] | null {
  if (type === 'mouseDown') return 'down';
  if (type === 'mouseMove') return 'move';
  if (type === 'mouseUp') return 'up';
  return null;
}

export async function openPickOverlay(
  window: BrowserWindow,
  tab: WebContentsView,
  bounds: Electron.Rectangle,
): Promise<{ view: WebContentsView; surface: PickSurface }> {
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(PARTITION),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  view.setBackgroundColor('#00000000');
  view.setBounds(bounds);
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  await contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  window.contentView.addChildView(view);

  const call = (method: string, ...args: unknown[]) => {
    if (contents.isDestroyed()) return;
    const list = args.map((arg) => JSON.stringify(arg)).join(',');
    void contents.executeJavaScript(`window.spark.${method}(${list})`).catch(() => undefined);
  };
  const gone = new Set<() => void>();
  const closing = () => {
    for (const listener of gone) listener();
  };
  tab.webContents.once('destroyed', closing);
  contents.once('destroyed', closing);

  const surface: PickSurface = {
    draw: (box, label) => call('draw', box, label),
    clear: () => call('clear'),
    busy: () => call('busy'),
    band: (box) => call('band', box),
    unband: () => call('unband'),
    mark: (box) => call('mark', box),
    unmark: () => call('unmark'),
    zoom: () => (tab.webContents.isDestroyed() ? 1 : tab.webContents.getZoomFactor()),
    onPointer(listener) {
      contents.on('before-mouse-event', (_event, mouse) => {
        const type = pointerKind(mouse.type);
        if (!type) return;
        const { x, y } = mouse;
        if (type !== 'up') {
          listener({ type, x, y, shift: false });
          return;
        }
        void contents
          .executeJavaScript('window.spark.shift')
          .catch(() => false)
          .then((shift) => listener({ type, x, y, shift: shift === true }));
      });
    },
    onKey(listener) {
      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        event.preventDefault();
        listener({ key: input.key, shift: input.shift });
      });
    },
    onWheel(listener) {
      contents.on('console-message', (details) => {
        if (!details.message.startsWith(WHEEL_PREFIX)) return;
        listener(JSON.parse(details.message.slice(WHEEL_PREFIX.length)) as PickWheel);
      });
    },
    onGone: (listener) => gone.add(listener),
    close() {
      gone.clear();
      if (!tab.webContents.isDestroyed()) tab.webContents.removeListener('destroyed', closing);
      if (!window.isDestroyed()) window.contentView.removeChildView(view);
      if (!contents.isDestroyed()) contents.close();
    },
  };
  return { view, surface };
}
