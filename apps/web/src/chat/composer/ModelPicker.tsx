import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useQueries } from '@tanstack/react-query';
import {
  DEFAULT_INVOLVEMENT_LEVEL,
  combinationLine,
  modeKind,
  shownModelName,
  type ChatSettings,
  type ProviderId,
  type ProviderSetup,
  type Run,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../../api/client.ts';
import { ProviderBlob } from '../../brand/ProviderBlob.tsx';
import { countLabel } from '../../ui/count-label.ts';
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
import { currentModel, selectableEfforts, unusableChoice } from './model-options.ts';
import { useChatSettingsUpdate, type PickerRequest } from './use-picker-command.ts';
import { permissionState } from './mode-summary.ts';
import { unlistedPinName } from './shown-model.ts';
import { PermissionChip } from './PermissionChip.tsx';
import './model-picker.css';
import { FreezeWhileHidden } from '../../ui/FreezeWhileHidden.tsx';

const SECTIONS: PickerSection[] = ['model', 'effort', 'permission', 'options'];

interface FocusRequest {
  count: number;
  from: 'model' | 'chip';
}

function nextFocus(previous: FocusRequest | null, from: FocusRequest['from']): FocusRequest {
  return { count: (previous?.count ?? 0) + 1, from };
}

interface ModelPickerProps {
  openRequest: PickerRequest | null;
  conversationId: string;
  settings: ChatSettings;
  providers: ProviderSetup[];
  runs: readonly Run[];
  hasRepos: boolean;
}

export function ModelPicker({
  openRequest,
  conversationId,
  settings,
  providers,
  runs,
  hasRepos,
}: ModelPickerProps) {
  const { open, setOpen, toggle, anchorRef, panelRef, returnFocusRef } = usePopover<
    HTMLDivElement,
    HTMLDivElement
  >();
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const listId = useId();
  const [section, setSection] = useState<PickerSection>('model');
  const [handledRequest, setHandledRequest] = useState(openRequest?.id ?? null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    const trigger = focusRequest.from === 'chip' ? chipRef : modelButtonRef;
    returnFocusRef.current = trigger.current;
    const frame = requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLElement>('[role="tab"][data-section][aria-selected="true"]')
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, panelRef, returnFocusRef]);
  const [direction, setDirection] = useState(1);
  const provider = settings.provider;

  const capabilityQueries = useQueries({
    queries: providers.map((entry) => ({
      ...capabilitiesQuery(entry.id),
      staleTime: CAPABILITIES_STALE_MS,
      enabled: entry.id === provider || open,
    })),
  });
  const queryFor = (id: ProviderId) =>
    capabilityQueries[providers.findIndex((entry) => entry.id === id)];
  const capabilitiesFor = (id: ProviderId) => queryFor(id)?.data;

  const update = useChatSettingsUpdate(conversationId);

  if (!provider) return null;
  const setup = providers.find((entry) => entry.id === provider);
  const capabilities = capabilitiesFor(provider);
  const model = currentModel(settings, capabilities);
  const efforts = selectableEfforts(capabilities);
  const level = settings.level ?? DEFAULT_INVOLVEMENT_LEVEL;
  const permission = permissionState(settings, capabilities);
  const permissionHint = combinationLine({
    provider,
    mode: permission.mode,
    kind: modeKind(capabilities?.modes ?? [], permission.mode),
    level,
    hasRepos,
  });
  const configOptions = capabilities?.options ?? [];
  const unusable = unusableChoice(settings.model, capabilities) !== null;
  const listedLabel = model ? shownModelName(model) : `${setup?.name ?? provider} default`;
  const pinnedLabel = unlistedPinName(settings, capabilities, runs) ?? listedLabel;
  const modelName = unusable ? `${pinnedLabel} (unavailable)` : pinnedLabel;

  const effort = efforts.find((option) => option.id === settings.effort);

  if (openRequest && openRequest.id !== handledRequest) {
    setHandledRequest(openRequest.id);
    setSection(openRequest.section);
    setOpen(true);
    setFocusRequest(nextFocus(focusRequest, 'model'));
  }

  const openPermissions = () => {
    returnFocusRef.current = chipRef.current;
    if (open && section === 'permission') {
      setOpen(false);
      return;
    }
    setDirection(1);
    setSection('permission');
    setOpen(true);
    setFocusRequest(nextFocus(focusRequest, 'chip'));
  };
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
      value: permission.label,
      disabled: !setup,
    },
    ...(configOptions.length > 0
      ? [
          {
            id: 'options' as const,
            label: 'Options',
            value: countLabel(configOptions.length, 'option'),
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
      <div ref={anchorRef} className="mtriggers">
        <button
          ref={modelButtonRef}
          type="button"
          className="mbtn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Model and effort: ${modelName}`}
          onClick={() => {
            returnFocusRef.current = modelButtonRef.current;
            setSection('model');
            toggle();
          }}
        >
          <ProviderBlob providerId={provider} size={18} animate="hover" />
          <span className="mname">{modelName}</span>
          <ChevronIcon />
        </button>
        {setup && (
          <PermissionChip
            ref={chipRef}
            state={permission}
            hint={permissionHint}
            expanded={open}
            panelId={panelId}
            onClick={openPermissions}
          />
        )}
      </div>
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop picker open' : 'mpop picker'}
        role="dialog"
        aria-label="Model, effort, and permissions"
      >
        <FreezeWhileHidden hidden={!open}>
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
                          onSelect={(next) => update.mutate({ model: next })}
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
        </FreezeWhileHidden>
        {update.isError && <p className="mpop-error">{update.error.message}</p>}
        <div className="picker-foot">Applies to this chat. New chats start with your defaults.</div>
      </div>
    </div>
  );
}
