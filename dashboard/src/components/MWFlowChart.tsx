import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box, Typography, Chip } from '@mui/material';
import type { ManifestWork, StatusFeedbackResult } from '../api/manifestWorkService';
import StatusFeedbackDisplay from './StatusFeedbackDisplay';

// ── Status helpers ─────────────────────────────────────────────────────────────

const borderColor = (status: string) => {
  if (status === 'Applied' || status === 'Available') return '#4caf50';
  if (status === 'Progressing' || status === 'Pending') return '#ff9800';
  if (status === 'Failed') return '#f44336';
  return '#9e9e9e';
};

const chipColor = (status: string): 'success' | 'warning' | 'error' | 'default' => {
  if (status === 'Applied' || status === 'Available') return 'success';
  if (status === 'Progressing' || status === 'Pending') return 'warning';
  if (status === 'Failed') return 'error';
  return 'default';
};

const deriveMWStatus = (mw: ManifestWork): string => {
  const applied = mw.conditions?.find(c => c.type === 'Applied');
  if (applied?.status === 'True') return 'Applied';
  if (applied?.status === 'False') return 'Failed';
  const available = mw.conditions?.find(c => c.type === 'Available');
  if (available?.status === 'True') return 'Available';
  return 'Pending';
};

const deriveResStatus = (conditions: { type: string; status: string }[]): string => {
  if (!conditions?.length) return 'Pending';
  const applied = conditions.find(c => c.type === 'Applied');
  if (applied?.status === 'True') return 'Applied';
  if (applied?.status === 'False') return 'Failed';
  return 'Pending';
};

// ── Custom node components ──────────────────────────────────────────────────

type MWData = { name: string; cluster: string; status: string };

function MWNode({ data }: { data: MWData }) {
  const color = borderColor(data.status);
  return (
    <Box sx={{ background: '#fff', border: `2px solid ${color}`, borderRadius: 2, p: 1.5, minWidth: 210, boxShadow: 2 }}>
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ background: color }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
        ManifestWork
      </Typography>
      <Typography variant="body2" fontWeight="bold">{data.name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">{data.cluster}</Typography>
      <Chip label={data.status} size="small" color={chipColor(data.status)} sx={{ mt: 0.75 }} />
    </Box>
  );
}

type ResData = { kind: string; name: string; namespace?: string; status: string; path: string; feedback?: StatusFeedbackResult };

function ResourceNode({ data }: { data: ResData }) {
  const navigate = useNavigate();
  const color = borderColor(data.status);
  return (
    <Box
      sx={{
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderLeft: `4px solid ${color}`,
        borderRadius: '0 8px 8px 0',
        p: 1.25,
        minWidth: 170,
        boxShadow: 1,
        cursor: 'pointer',
        '&:hover': { boxShadow: 4, borderColor: color },
      }}
      onClick={() => navigate(data.path)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ background: color }} />
      <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 'bold' }} display="block">
        {data.kind}
      </Typography>
      <Typography variant="body2" noWrap title={data.name}>{data.name}</Typography>
      {data.namespace && (
        <Typography variant="caption" color="text.secondary" display="block">{data.namespace}</Typography>
      )}
      <Chip label={data.status} size="small" color={chipColor(data.status)} sx={{ mt: 0.75 }} />
      {data.feedback?.values?.length && (
        <Box sx={{ mt: 0.5 }}>
          <StatusFeedbackDisplay feedback={data.feedback} variant="compact" maxItems={2} />
        </Box>
      )}
    </Box>
  );
}

const nodeTypes: NodeTypes = {
  mwNode: MWNode as never,
  resourceNode: ResourceNode as never,
};

// ── Graph layout ───────────────────────────────────────────────────────────────

const ROW_H = 110;
const LX = [50, 450];

function buildGraph(mw: ManifestWork) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const edgeStyle = { stroke: '#bdbdbd' };
  const marker = { type: MarkerType.ArrowClosed, color: '#bdbdbd' };

  const resources = mw.resourceStatus?.manifests ?? [];
  const totalH = Math.max(1, resources.length) * ROW_H;

  const mwStatus = deriveMWStatus(mw);

  nodes.push({
    id: 'mw',
    type: 'mwNode',
    position: { x: LX[0], y: Math.max(0, totalH / 2 - 55) },
    data: { name: mw.name, cluster: mw.namespace, status: mwStatus },
  });

  resources.forEach((res, i) => {
    const nodeId = `res-${res.resourceMeta.ordinal}`;
    nodes.push({
      id: nodeId,
      type: 'resourceNode',
      position: { x: LX[1], y: i * ROW_H },
      data: {
        kind: res.resourceMeta.kind ?? 'Resource',
        name: res.resourceMeta.name ?? '-',
        namespace: res.resourceMeta.namespace,
        status: deriveResStatus(res.conditions ?? []),
        path: `/resources/${mw.namespace}/${mw.name}/${res.resourceMeta.ordinal}`,
        feedback: res.statusFeedback,
      },
    });
    edges.push({
      id: `e-mw-${nodeId}`,
      source: 'mw',
      target: nodeId,
      type: 'smoothstep',
      markerEnd: marker,
      style: edgeStyle,
    });
  });

  return { nodes, edges };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  mw: ManifestWork;
}

export default function MWFlowChart({ mw }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(mw), [mw]);

  if (!mw.resourceStatus?.manifests?.length) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Typography color="text.secondary">No resource status available</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: 'calc(100vh - 320px)', minHeight: 420, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesConnectable={false}
        nodesDraggable={false}
        deleteKeyCode={null}
      >
        <Background color="#e0e0e0" gap={20} />
        <Controls />
      </ReactFlow>
    </Box>
  );
}
