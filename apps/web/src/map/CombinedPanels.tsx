import { Fragment, useState } from 'react';
import type { MapUnmatched, MapUnmatchedEndpoint } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import { MoveIcon, XIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import type { Bridge } from './bridges.ts';
import { baseName } from './file-kind.ts';
import type { Scene } from './scene.ts';

interface BridgeListProps {
  bridges: readonly Bridge[];
  onFocus: (key: string | null) => void;
  onPick: (key: string) => void;
}

export function BridgeList({ bridges, onFocus, onPick }: BridgeListProps) {
  const sorted = [...bridges].sort((a, b) => b.links.length - a.links.length);
  return (
    <ul className="map-bridges map-glass" aria-label="Links between projects">
      {sorted.map((bridge) => {
        const first = bridge.links[0]!;
        const more = bridge.links.length > 1 ? `, and ${bridge.links.length - 1} more` : '';
        return (
          <li key={bridge.key}>
            <button
              type="button"
              onFocus={() => onFocus(bridge.key)}
              onBlur={() => onFocus(null)}
              onClick={() => onPick(bridge.key)}
            >
              <span className="map-mono">{first.label}</span>
              <small>
                {baseName(first.fromPath)} to {baseName(first.toPath)}
                {more}
              </small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ROLES = ['Caller', 'Client call', 'Route', 'Handler', 'Data', 'Data'];

interface PathCardProps {
  scene: Scene;
  bridge: Bridge;
  path: readonly number[];
  onStep: (file: number) => void;
  onClose: () => void;
}

export function PathCard({ scene, bridge, path, onStep, onClose }: PathCardProps) {
  const callerFirst = path.length > 0 && scene.files[path[0]!]!.kind === 'ui' && path.length > 2;
  const roles = callerFirst ? ROLES : ROLES.slice(1);
  return (
    <nav className="map-pathcard map-glass" aria-label="Likely path" data-map-overlay>
      <span className="map-path-head">
        <small>
          Likely path{' '}
          <InfoTip
            topic="the likely path"
            text="Traced from imports and route definitions in the code. It shows how a request probably flows, not a recorded run."
          />
        </small>
        <span className="map-mono">{bridge.links[0]!.label}</span>
      </span>
      {path.map((file, step) => (
        <Fragment key={file}>
          {step > 0 && (
            <span className="map-arrow">
              <MoveIcon />
            </span>
          )}
          <button type="button" className="map-step" onClick={() => onStep(file)}>
            <small>
              {step + 1} · {roles[step] ?? 'Step'}
            </small>
            <span>{scene.files[file]!.name}</span>
          </button>
        </Fragment>
      ))}
      <button type="button" className="map-icon-btn" aria-label="Clear path" onClick={onClose}>
        <XIcon />
      </button>
    </nav>
  );
}

interface UnmatchedPanelProps {
  unmatched: MapUnmatched;
  onPick: (endpoint: MapUnmatchedEndpoint) => void;
  onHover: (endpoint: MapUnmatchedEndpoint | null) => void;
  onClose: () => void;
}

export function UnmatchedPanel({ unmatched, onPick, onHover, onClose }: UnmatchedPanelProps) {
  const [tab, setTab] = useState<'routes' | 'calls'>('routes');
  const list = tab === 'routes' ? unmatched.routes : unmatched.calls;
  const total = tab === 'routes' ? unmatched.routeTotal : unmatched.callTotal;
  return (
    <section className="map-unm map-glass" aria-labelledby="map-unm-title" data-map-overlay>
      <div className="map-unm-h">
        <h3 id="map-unm-title">Unmatched</h3>
        <span className="map-sp" />
        <button
          type="button"
          className="map-icon-btn"
          aria-label="Close unmatched list"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <Segmented
        ariaLabel="Unmatched kind"
        options={[
          { id: 'routes', label: `Routes nobody calls · ${unmatched.routeTotal}` },
          { id: 'calls', label: `Calls with no route · ${unmatched.callTotal}` },
        ]}
        value={tab}
        onChange={(id) => setTab(id === 'calls' ? 'calls' : 'routes')}
      />
      {list.length > 0 ? (
        <ul onPointerLeave={() => onHover(null)}>
          {list.map((endpoint) => (
            <li key={`${endpoint.projectId}:${endpoint.method}:${endpoint.path}:${endpoint.file}`}>
              <button
                type="button"
                onClick={() => onPick(endpoint)}
                onPointerEnter={() => onHover(endpoint)}
                onFocus={() => onHover(endpoint)}
              >
                <span className="map-meth">{endpoint.method}</span>
                <span className="map-ep-col">
                  <span className="map-ep">{endpoint.path}</span>
                  <small>
                    {tab === 'routes' && (
                      <span className={endpoint.confirmedBy ? 'map-flag sure' : 'map-flag'}>
                        {endpoint.confirmedBy ? 'Unused' : 'Possibly unused'} ·{' '}
                      </span>
                    )}
                    <span className="map-fl">{baseName(endpoint.file)}</span>
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="map-none">
          <BlobScout size={22} mood="happy" />
          <span>
            {tab === 'routes'
              ? 'Every route is called from the projects on the map.'
              : 'Every call reaches a route.'}
          </span>
        </div>
      )}
      <p className="map-note">
        {list.length < total && `Showing the ${list.length} most important of ${total}. `}
        Matched by method and path in the source. Downloads, uploads and streams opened another way
        can show up here.
      </p>
    </section>
  );
}
