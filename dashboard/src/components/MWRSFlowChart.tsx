import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box, Typography, Chip, CircularProgress, Alert } from '@mui/material';
import type { ManifestWorkReplicaSet } from '../api/manifestWorkReplicaSetService';
import { fetchManifestWorksByReplicaSet } from '../api/manifestWorkReplicaSetService';
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

type MWRSData = { name: string; namespace: string; status: string };

function MWRSNode({ data }: { data: MWRSData }) {
  return (
    <Box sx={{ background: '#fff', border: '2px solid #1976d2', borderRadius: 2, p: 1.5, minWidth: 210, boxShadow: 2 }}>
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ background: '#1976d2' }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
        ManifestWorkReplicaSet
      </Typography>
      <Typography variant="body2" fontWeight="bold">{data.name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">{data.namespace}</Typography>
      <Chip label={data.status} size="small" color={chipColor(data.status)} sx={{ mt: 0.75 }} />
    </Box>
  );
}

type MWData = { cluster: string; status: string };

function ManifestWorkNode({ data }: { data: MWData }) {
  const color = borderColor(data.status);
  return (
    <Box sx={{ background: '#fff', border: '1px solid #e0e0e0', borderLeft: `4px solid ${color}`, borderRadius: '0 8px 8px 0', p: 1.5, minWidth: 190, boxShadow: 1 }}>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ background: color }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ background: color }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
        ManifestWork
      </Typography>
      <Typography variant="body2" fontWeight="bold">{data.cluster}</Typography>
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
  mwrsNode: MWRSNode as never,
  manifestWorkNode: ManifestWorkNode as never,
  resourceNode: ResourceNode as never,
};

// ── Graph layout ───────────────────────────────────────────────────────────────

const ROW_H = 110;
const MW_GAP = 24;
const LX = [50, 390, 730];

function buildGraph(mwrs: ManifestWorkReplicaSet, manifestWorks: ManifestWork[]) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const edgeStyle = { stroke: '#bdbdbd' };
  const marker = { type: MarkerType.ArrowClosed, color: '#bdbdbd' };

  let totalH = 0;
  const layout = manifestWorks.map(mw => {
    const resources = mw.resourceStatus?.manifests ?? [];
    const slots = Math.max(1, resources.length);
    const blockH = slots * ROW_H;
    const startY = totalH;
    totalH += blockH + MW_GAP;
    return { mw, resources, startY, blockH };
  });
  if (layout.length === 0) totalH = ROW_H;

  const mwrsCond = mwrs.conditions?.find(c => c.type === 'ManifestworkApplied');
  const mwrsStatus = mwrsCond?.status === 'True' ? 'Applied'
    : mwrsCond?.reason === 'Processing' ? 'Progressing'
    : 'Pending';

  nodes.push({
    id: 'mwrs',
    type: 'mwrsNode',
    position: { x: LX[0], y: Math.max(0, (totalH - MW_GAP) / 2 - 55) },
    data: { name: mwrs.name, namespace: mwrs.namespace, status: mwrsStatus },
  });

  for (const { mw, resources, startY, blockH } of layout) {
    const mwId = `mw-${mw.namespace}`;
    nodes.push({
      id: mwId,
      type: 'manifestWorkNode',
      position: { x: LX[1], y: startY + blockH / 2 - 45 },
      data: { cluster: mw.namespace, status: deriveMWStatus(mw) },
    });
    edges.push({
      id: `e-mwrs-${mw.namespace}`,
      source: 'mwrs',
      target: mwId,
      type: 'smoothstep',
      markerEnd: marker,
      style: edgeStyle,
    });

    resources.forEach((res, i) => {
      const nodeId = `res-${mw.namespace}-${res.resourceMeta.ordinal}`;
      nodes.push({
        id: nodeId,
        type: 'resourceNode',
        position: { x: LX[2], y: startY + i * ROW_H },
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
        id: `e-${mw.namespace}-${nodeId}`,
        source: mwId,
        target: nodeId,
        type: 'smoothstep',
        markerEnd: marker,
        style: edgeStyle,
      });
    });
  }

  return { nodes, edges };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  mwrs: ManifestWorkReplicaSet;
}

export default function MWRSFlowChart({ mwrs }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetchManifestWorksByReplicaSet(mwrs.namespace, mwrs.name)
      .then((mws) => {
        const { nodes: n, edges: e } = buildGraph(mwrs, mws);
        setNodes(n);
        setEdges(e);
      })
      .catch(() => setError('Failed to load ManifestWorks'))
      .finally(() => setIsLoading(false));
  }, [mwrs.namespace, mwrs.name]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box sx={{ height: 'calc(100vh - 320px)', minHeight: 420, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesConnectable={false}
        deleteKeyCode={null}
      >
        <Background color="#e0e0e0" gap={20} />
        <Controls />
      </ReactFlow>
    </Box>
  );
}
