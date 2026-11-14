import '@xyflow/react/dist/base.css';
import './flow-graph.css';
import { memo, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { WorkflowStep, WorkflowStepState } from '@spark-outpost/contracts';
import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH } from './flow-layout.ts';
import type { CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';
import { RunStepState } from './RunState.tsx';
import { useFlowLayout } from './use-flow-layout.ts';

interface FlowGraphProps {
  steps: readonly Pick<WorkflowStep, 'id' | 'dependsOn' | 'sparkId'>[];
  labels: ReadonlyMap<string, string>;
  sparks: ReadonlyMap<string, CrewSpark>;
  states?: Readonly<Record<string, WorkflowStepState>>;
  finished?: ReadonlySet<string>;
  asking?: ReadonlySet<string>;
  selected?: string | null;
  label: string;
}

type StepNodeData = {
  label: string;
  spark: CrewSpark | undefined;
  state: WorkflowStepState | null;
  selected: boolean;
  asking: boolean;
};
type StepNode = Node<StepNodeData, 'step'>;

const StepNodeView = memo(function StepNodeView({ data }: NodeProps<StepNode>) {
  return (
    <div
      className="wf-node"
      data-state={data.state ?? undefined}
      data-selected={data.selected || undefined}
    >
      <Handle className="wf-node-handle" type="target" position={Position.Left} />
      <SparkDot spark={data.spark} size={26} />
      <span className="wf-node-text">
        <b>{data.label}</b>
        {data.state && <RunStepState state={data.state} asking={data.asking} />}
      </span>
      <Handle className="wf-node-handle" type="source" position={Position.Right} />
    </div>
  );
});

const NODE_TYPES = { step: StepNodeView };
const FIT = { padding: 0.16, maxZoom: 1 };

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function edgeClass(
  id: string,
  target: string,
  states: FlowGraphProps['states'],
  finished: FlowGraphProps['finished'],
): string {
  if (states && states[target] === 'skipped') return 'wf-edge quiet';
  if (!finished) return 'wf-edge';
  return finished.has(id) ? 'wf-edge done' : 'wf-edge pending';
}

function Canvas({
  steps,
  labels,
  sparks,
  states,
  finished,
  asking,
  selected,
  label,
}: FlowGraphProps) {
  const flow = useReactFlow();
  const input = useMemo(
    () => ({
      nodes: steps.map((step) => ({ id: step.id })),
      edges: steps.flatMap((step) =>
        [...new Set(step.dependsOn)].map((parent) => ({ source: parent, target: step.id })),
      ),
    }),
    [steps],
  );
  const layout = useFlowLayout(input);

  const nodes = useMemo<StepNode[]>(() => {
    if (!layout) return [];
    return steps.flatMap((step) => {
      const position = layout.result.at[step.id];
      if (!position) return [];
      return [
        {
          id: step.id,
          type: 'step' as const,
          position,
          width: FLOW_NODE_WIDTH,
          height: FLOW_NODE_HEIGHT,
          data: {
            label: labels.get(step.id) ?? step.id,
            spark: sparks.get(step.sparkId),
            state: states?.[step.id] ?? null,
            selected: selected === step.id,
            asking: asking?.has(step.id) ?? false,
          },
        },
      ];
    });
  }, [layout, steps, labels, sparks, states, selected, asking]);

  const edges = useMemo<Edge[]>(() => {
    if (!layout) return [];
    const placed = layout.result.at;
    return input.edges
      .filter((edge) => placed[edge.source] && placed[edge.target])
      .map((edge) => {
        const id = `${edge.source}>${edge.target}`;
        return {
          id,
          source: edge.source,
          target: edge.target,
          className: edgeClass(id, edge.target, states, finished),
        };
      });
  }, [layout, input.edges, states, finished]);

  const signature = layout?.signature ?? '';
  useEffect(() => {
    if (signature === '') return;
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ ...FIT, duration: reducedMotion() ? 0 : 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [signature, flow]);

  return (
    <div className="wf-graph" role="figure" aria-label={label} aria-busy={!layout || undefined}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        disableKeyboardA11y
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        maxZoom={1.5}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
      </ReactFlow>
    </div>
  );
}

export default function FlowGraph(props: FlowGraphProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
