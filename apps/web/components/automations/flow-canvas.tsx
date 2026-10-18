'use client';
// FlowCanvas (components.md §6, advanced view, T-202): the escalation chain as a node graph (@xyflow/react).
// Read-only visualisation with selectable nodes; editing happens in the guided list (full keyboard support),
// which stays visible next to it. Always an LTR island, even in /ur. Edges flow subtly to show the path of a
// lead (never to imply success); no animation under prefers-reduced-motion.
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BellRing, Siren, UsersRound, Zap } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { cn } from '@/components/ui/cn';
import { useDuration } from './parts';
import type { Draft } from './policy-model';
import { useTargetLabel } from './rule-summary';
import type { Person } from './use-automations';

type Kind = 'trigger' | 'assign' | 'wait' | 'critical';
interface FlowData extends Record<string, unknown> {
  kind: Kind;
  title: string;
  detail?: string;
  selected?: boolean;
}

const ICON = { trigger: Zap, assign: UsersRound, wait: BellRing, critical: Siren } as const;

function FlowNode({ data }: NodeProps<Node<FlowData>>) {
  const Icon = ICON[data.kind];
  return (
    <div
      className={cn(
        'w-44 rounded-card border bg-surface p-3 shadow-card',
        data.kind === 'wait' && 'border-warning/50 bg-warning-surface',
        data.kind === 'critical' && 'border-danger/50 bg-danger-surface',
        data.kind !== 'wait' && data.kind !== 'critical' && 'border-line',
        data.selected && 'ring-2 ring-brand ring-offset-2 ring-offset-canvas',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-line-strong" />
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0',
            data.kind === 'wait' ? 'text-warning' : data.kind === 'critical' ? 'text-danger' : 'text-fg-2',
          )}
        />
        <div className="min-w-0">
          <p className="text-meta font-semibold text-fg">{data.title}</p>
          {data.detail ? <p className="mt-0.5 text-meta text-fg-2">{data.detail}</p> : null}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-line-strong" />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

export function FlowCanvas({
  draft,
  people,
  names,
  selected,
  onSelect,
}: {
  draft: Draft;
  people: Person[];
  names: { backup?: string; manager?: string };
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  const t = useTranslations('automations.policy');
  const dur = useDuration();
  const label = useTargetLabel(people, names);
  const reduce = useReducedMotion();

  const { nodes, edges } = useMemo(() => {
    const ns: Node<FlowData>[] = [];
    const es: Edge[] = [];
    let x = 0;
    const GAP = 232;
    const push = (id: string, data: FlowData) => {
      ns.push({ id, type: 'flow', position: { x, y: 0 }, data, draggable: false, connectable: false });
      x += GAP;
    };
    push('arrives', { kind: 'trigger', title: t('chain.arrives') });
    draft.levels.forEach((l, i) => {
      push(`a${i}`, {
        kind: 'assign',
        title: i === 0 ? t('flow.assign') : t('flow.escalate'),
        detail: label(l),
        selected: selected === i,
      });
      push(`w${i}`, {
        kind: 'wait',
        title: t('flow.wait'),
        detail: dur(l.timeoutSeconds),
        selected: selected === i,
      });
    });
    push('critical', {
      kind: 'critical',
      title: t('chain.critical'),
      detail: draft.repeatCount > 1 ? t('flow.afterRepeat', { count: draft.repeatCount }) : undefined,
    });
    for (let i = 0; i < ns.length - 1; i++) {
      es.push({
        id: `e${i}`,
        source: ns[i]!.id,
        target: ns[i + 1]!.id,
        type: 'smoothstep',
        animated: !reduce,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-line-strong)' },
        style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.5 },
      });
    }
    return { nodes: ns, edges: es };
  }, [draft, label, dur, reduce, selected, t]);

  return (
    <div
      dir="ltr"
      role="img"
      aria-label={t('flow.aria', { count: draft.levels.length })}
      className="h-48 overflow-hidden rounded-card border border-line bg-canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 16, y: 56, zoom: 0.85 }}
        minZoom={0.5}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: false }}
        onNodeClick={(_, n) => {
          const m = /^[aw](\d+)$/.exec(n.id);
          onSelect(m ? Number(m[1]) : null);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--color-line-strong)" />
      </ReactFlow>
    </div>
  );
}
