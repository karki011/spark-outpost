import { useEffect, useId, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_INVOLVEMENT_LEVEL,
  type ChatSettings,
  type ConversationDetail,
  type Orchestration,
  type ProviderId,
  type ProviderSetup,
  type UpdateChatSettingsRequest,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { ProviderBlob } from '../../brand/ProviderBlob.tsx';
import { ChevronIcon } from '../../ui/icons.tsx';
import { reveal } from '../../ui/transitions.tsx';
import { usePopover } from '../../ui/use-popover.ts';
import { EffortMeter } from './EffortMeter.tsx';
import { EffortOptions } from './EffortOptions.tsx';
import { ModelList } from './ModelList.tsx';
import { ConfigOptions } from './ConfigOptions.tsx';
import { ModeOptions } from './ModeOptions.tsx';
import { PickerNav, type PickerRow, type PickerSection } from './PickerNav.tsx';
import { ProviderSwitch } from './ProviderSwitch.tsx';
import { ExitingInert } from './ExitingInert.tsx';
import { autoThisTurn, autoWouldHaveUsed, builderRouteNote } from '../../crew/auto-route.ts';
import { buttonLabel, currentModel, selectableEfforts, shortLabel } from './model-options.ts';
import { permissionSummary } from './mode-summary.ts';
import './model-picker.css';

const SECTIONS: PickerSection[] = ['model', 'effort', 'permission', 'options'];

export interface PickerRequest {
  section: PickerSection;
  id: number;
  value?: string;
}

interface ModelPickerProps {
  openRequest?: PickerRequest | null;
  onNotice?: (message: string) => void;
  conversationId: string;
  settings: ChatSettings;
  providers: ProviderSetup[];
  hasRepos?: boolean;
  orchestration?: Orchestration | null;
}

const HOUR = 60 * 60 * 1000;

export function ModelPicker({
  openRequest = null,
  onNotice,
  conversationId,
  settings,
  providers,
  hasRepos = false,
  orchestration = null,
}: ModelPickerProps) {
  const queryClient = useQueryClient();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const panelId = useId();
  const listId = useId();
  const [section, setSection] = useState<PickerSection>('model');
  const [handledRequest, setHandledRequest] = useState(openRequest?.id ?? null);
  const [focusRequest, setFocusRequest] = useState<number | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, panelRef]);
  const [direction, setDirection] = useState(1);
  const provider = settings.provider;

  const capabilityQueries = useQueries({
    queries: providers.map((entry) => ({
      queryKey: queryKeys.capabilities(entry.id),
      queryFn: () => api.getCapabilities(entry.id),
      staleTime: HOUR,
      enabled: entry.id === provider || open,
    })),
  });
  const queryFor = (id: ProviderId) =>
    capabilityQueries[providers.findIndex((entry) => entry.id === id)];
  const capabilitiesFor = (id: ProviderId) => queryFor(id)?.data;

  const update = useMutation({
    mutationFn: (change: UpdateChatSettingsRequest) =>
      api.updateChatSettings(conversationId, change),
    onSuccess: (next) =>
      queryClient.setQueryData<ConversationDetail>(
        queryKeys.conversation(conversationId),
        (detail) => (detail ? { ...detail, settings: next } : detail),
      ),
  });

  if (!provider) return null;
  const setup = providers.find((entry) => entry.id === provider);
  const capabilities = capabilitiesFor(provider);
  const model = currentModel(settings, capabilities);
  const efforts = selectableEfforts(capabilities);
  const level = settings.level ?? DEFAULT_INVOLVEMENT_LEVEL;
  const access = hasRepos ? permissionSummary(settings, capabilities) : null;
  const configOptions = capabilities?.options ?? [];
  const pinnedName = model ? buttonLabel(model) : `${setup?.name ?? provider} default`;
  const auto = settings.routing === 'auto';
  const thisTurn = autoThisTurn(orchestration);
  const modelName = auto ? (thisTurn ? `Auto · ${thisTurn} this turn` : 'Auto') : pinnedName;
  const buttonName = access ? `${modelName} · ${access}` : modelName;
  const would = autoWouldHaveUsed(orchestration);
  const hint = builderRouteNote(orchestration) ?? (would ? `Jev would have used ${would}` : null);

  const effort = efforts.find((option) => option.id === settings.effort);

  if (openRequest && openRequest.id !== handledRequest) {
    setHandledRequest(openRequest.id);
    const wanted = openRequest.value?.trim().toLowerCase() ?? '';
    const options = openRequest.section === 'effort' ? efforts : (capabilities?.models ?? []);
    const match = wanted
      ? options.find(
          (option) =>
            option.id.toLowerCase() === wanted || shortLabel(option.label).toLowerCase() === wanted,
        )
      : undefined;
    if (match && openRequest.section === 'effort') {
      update.mutate({ effort: match.id });
      onNotice?.(`Effort set to ${match.label}.`);
    } else if (match) {
      update.mutate({ model: match.id, routing: 'pinned' });
      onNotice?.(`Model set to ${shortLabel(match.label)}.`);
    } else {
      if (wanted)
        onNotice?.(`${setup?.name ?? 'This agent'} doesn't offer "${openRequest.value}".`);
      setSection(openRequest.section);
      setOpen(true);
      setFocusRequest(openRequest.id);
    }
  }
  const rows: PickerRow[] = [
    {
      id: 'model',
      label: 'Model',
      value: modelName,
      disabled: false,
    },
    {
      id: 'effort',
      label: 'Effort',
      value: (
        <>
          <EffortMeter efforts={efforts} effort={settings.effort} />
          {effort?.label ?? 'Default'}
        </>
      ),
      disabled: efforts.length === 0,
    },
    {
      id: 'permission',
      label: 'Permissions',
      value: access ?? 'Chat',
      disabled: !setup,
    },
    ...(configOptions.length > 0
      ? [
          {
            id: 'options' as const,
            label: 'Options',
            value: `${configOptions.length} ${configOptions.length === 1 ? 'option' : 'options'}`,
            disabled: false,
          },
        ]
      : []),
  ];
  const activeSection = section === 'options' && configOptions.length === 0 ? 'model' : section;

  const selectSection = (next: PickerSection) => {
    setDirection(SECTIONS.indexOf(next) >= SECTIONS.indexOf(activeSection) ? 1 : -1);
    setSection(next);
  };

  return (
    <div className="mpicker">
      <button
        ref={anchorRef}
        type="button"
        className="mbtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Model and effort: ${buttonName}`}
        onClick={() => {
          setSection('model');
          toggle();
        }}
      >
        <ProviderBlob providerId={provider} size={18} animate="hover" />
        <span className="mname">{modelName}</span>
        {access && <span className="maccess">· {access}</span>}
        <EffortMeter efforts={efforts} effort={settings.effort} />
        <ChevronIcon />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop picker open' : 'mpop picker'}
        role="dialog"
        aria-label="Model, effort, and permissions"
      >
        <LayoutGroup id={panelId}>
          <div className="picker-top">
            <span className="picker-title">
              {setup?.name}
              <small>{update.isPending ? 'Switching…' : 'Used in this chat'}</small>
            </span>
            {providers.length > 1 && (
              <ProviderSwitch
                providers={providers}
                active={provider}
                onSelect={(id) => {
                  if (id === provider) return;
                  setDirection(
                    providers.findIndex((entry) => entry.id === id) >
                      providers.findIndex((entry) => entry.id === provider)
                      ? 1
                      : -1,
                  );
                  update.mutate({ provider: id });
                }}
              />
            )}
          </div>
          <div className="picker-body">
            <PickerNav
              rows={rows}
              active={activeSection}
              panelId={listId}
              onSelect={selectSection}
            />
            <div className="picker-pane" id={listId} role="tabpanel">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={`${provider}:${activeSection}`}
                  custom={direction}
                  initial={{ opacity: 0, y: 14 * direction }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 * direction }}
                  transition={reveal}
                >
                  <ExitingInert>
                    {activeSection === 'model' && setup && (
                      <ModelList
                        provider={setup}
                        capabilities={capabilities}
                        loading={queryFor(provider)?.isFetching ?? false}
                        selected={model?.id ?? null}
                        onSelect={(next) => update.mutate({ model: next, routing: 'pinned' })}
                        routing={settings.routing ?? 'pinned'}
                        onAuto={() => update.mutate({ routing: 'auto' })}
                        hint={hint}
                      />
                    )}
                    {activeSection === 'effort' && (
                      <EffortOptions
                        efforts={efforts}
                        selected={settings.effort}
                        onSelect={(next) => update.mutate({ effort: next })}
                      />
                    )}
                    {activeSection === 'permission' && setup && (
                      <ModeOptions
                        provider={provider}
                        modes={capabilities?.modes ?? []}
                        defaultMode={capabilities?.defaultMode ?? null}
                        selected={settings.agentMode}
                        level={level}
                        hasRepos={hasRepos}
                        loading={queryFor(provider)?.isFetching ?? false}
                        onMode={(next) => update.mutate({ agentMode: next })}
                        onLevel={(next) => update.mutate({ level: next })}
                      />
                    )}
                    {activeSection === 'options' && (
                      <ConfigOptions
                        options={configOptions}
                        values={settings.options}
                        onChange={(id, value) => update.mutate({ options: { [id]: value } })}
                      />
                    )}
                  </ExitingInert>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </LayoutGroup>
        {update.isError && <p className="mpop-error">{update.error.message}</p>}
        <div className="picker-foot">Applies to this chat. New chats start with your defaults.</div>
      </div>
    </div>
  );
}
