import type {
  VoiceModel,
  VoiceModelId,
  VoiceModelStatus,
  VoiceModelStatuses,
} from '@spark-outpost/contracts';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { downloadModel, modelPath, modelPresent, type FetchModel } from './model.ts';

export interface ModelStoreEffects {
  dir: string;
  models: readonly VoiceModel[];
  fetch: FetchModel;
  changed(): void;
  log(line: string): void;
}

export type DownloadOutcome = 'ready' | 'cancelled' | 'failed' | 'busy';

const RETIRED_MODELS = [
  {
    file: 'ggml-base-q5_1.bin',
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  },
  {
    file: 'ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
];

export async function removeRetiredModels(dir: string): Promise<void> {
  for (const model of RETIRED_MODELS) {
    await rm(path.join(dir, model.file), { force: true }).catch(() => undefined);
    await rm(path.join(dir, `${model.sha256}.partial`), { force: true }).catch(() => undefined);
  }
}

const MISSING: VoiceModelStatus = { state: 'missing', progress: null, problem: null };

export function createModelStore(effects: ModelStoreEffects) {
  const states = new Map<VoiceModelId, VoiceModelStatus>(
    effects.models.map((model) => [model.id, MISSING]),
  );
  let active: { id: VoiceModelId; controller: AbortController } | null = null;

  const find = (id: VoiceModelId) => effects.models.find((model) => model.id === id)!;
  const state = (id: VoiceModelId) => states.get(id) ?? MISSING;
  const set = (id: VoiceModelId, next: VoiceModelStatus) => {
    states.set(id, next);
    effects.changed();
  };

  const present = (id: VoiceModelId) => modelPresent(effects.dir, find(id));

  return {
    model: find,
    state,
    present,
    path: (id: VoiceModelId) => modelPath(effects.dir, find(id)),
    downloading: () => active?.id ?? null,

    snapshot(): VoiceModelStatuses {
      return Object.fromEntries(
        effects.models.map((model) => [model.id, { ...state(model.id) }]),
      ) as VoiceModelStatuses;
    },

    async refresh() {
      for (const model of effects.models) {
        const now = state(model.id);
        if (now.state === 'downloading' || now.state === 'failed') continue;
        const next = (await present(model.id)) ? 'ready' : 'missing';
        if (next !== now.state) states.set(model.id, { ...MISSING, state: next });
      }
    },

    failed(id: VoiceModelId, problem: string) {
      set(id, { state: 'failed', progress: null, problem });
    },

    async download(id: VoiceModelId): Promise<DownloadOutcome> {
      if (active) return 'busy';
      const controller = new AbortController();
      active = { id, controller };
      set(id, { state: 'downloading', progress: 0, problem: null });
      try {
        await downloadModel({
          dir: effects.dir,
          model: find(id),
          fetch: effects.fetch,
          signal: controller.signal,
          progress: (fraction) => {
            const rounded = Math.floor(fraction * 100) / 100;
            if (rounded === state(id).progress) return;
            set(id, { state: 'downloading', progress: rounded, problem: null });
          },
        });
        set(id, { state: 'ready', progress: null, problem: null });
        return 'ready';
      } catch (error) {
        if (controller.signal.aborted) {
          set(id, MISSING);
          return 'cancelled';
        }
        const problem = (error as Error).message || 'The download didn’t check out.';
        effects.log(`Voice model download failed: ${problem}`);
        set(id, { state: 'failed', progress: null, problem });
        return 'failed';
      } finally {
        active = null;
      }
    },

    cancel(id: VoiceModelId) {
      if (active?.id === id) active.controller.abort();
    },

    dispose() {
      active?.controller.abort();
    },
  };
}
