import React, { useState, useRef } from 'react';
import { 
  Play, Pause, Plus, Trash2, ShieldCheck, Database, Filter, Cpu, 
  Boxes, Sparkles, FolderArchive, Radio, Server, Globe, Layers, 
  Lock, Eye, Code2, CheckCircle, AlertCircle, RefreshCw, ZoomIn, 
  ZoomOut, Maximize2, X, Download, Sliders, ChevronRight
} from 'lucide-react';
import { CanvasNode, CanvasEdge, Pipeline, NodeType, NodeStatus, PIIType, MaskingMethod } from '../../types';
import { AVAILABLE_CONNECTORS, AVAILABLE_OPERATORS, MOCK_RAW_SAMPLE, MOCK_MASKED_SAMPLE } from '../../data/initialData';
import { DbtSqlEditorModal, getDbtLayer } from './DbtSqlEditorModal';
import { buildBronzeLayer, buildSilverLayer, BronzeTableResult, fetchConnectionJobs, triggerAirbyteSync } from '../../lib/airbyteGateway';
import { mapSyncStatusToNodeStatus } from '../../lib/pipelineBuilder';

interface VisualCanvasProps {
  pipeline: Pipeline;
  onUpdatePipeline: (updated: Pipeline) => void;
  canEdit: boolean;
  canExecute: boolean;
  canViewRawPII: boolean;
}

export const isMedallionDbtNode = (node: CanvasNode | null | undefined): boolean => {
  if (!node) return false;
  const typeLower = (node.type || '').toLowerCase();
  const titleLower = (node.title || '').toLowerCase();
  const subtitleLower = (node.subtitle || '').toLowerCase();

  return (
    typeLower === 'bronze' ||
    typeLower === 'silver' ||
    typeLower === 'gold' ||
    titleLower.includes('bronze') ||
    titleLower.includes('silver') ||
    titleLower.includes('gold') ||
    subtitleLower.includes('bronze') ||
    subtitleLower.includes('silver') ||
    subtitleLower.includes('gold') ||
    titleLower.includes('ouro') ||
    titleLower.includes('prata')
  );
};

export const VisualCanvas: React.FC<VisualCanvasProps> = ({
  pipeline,
  onUpdatePipeline,
  canEdit,
  canExecute,
  canViewRawPII
}) => {
  const [nodes, setNodes] = useState<CanvasNode[]>(pipeline.nodes);
  const [edges, setEdges] = useState<CanvasEdge[]>(pipeline.edges);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [dbtEditingNode, setDbtEditingNode] = useState<CanvasNode | null>(null);
  const [isExecutingPipeline, setIsExecutingPipeline] = useState(false);
  const [pipelineExecError, setPipelineExecError] = useState<string | null>(null);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [dragDistance, setDragDistance] = useState(0);
  const [bronzeBuild, setBronzeBuild] = useState<{
    status: 'idle' | 'running' | 'done' | 'error';
    results?: BronzeTableResult[];
    error?: string;
  }>({ status: 'idle' });
  const [silverBuild, setSilverBuild] = useState<{
    status: 'idle' | 'running' | 'done' | 'error';
    results?: BronzeTableResult[];
    error?: string;
  }>({ status: 'idle' });
  // Table filter (one Bronze node per table — see pipelineBuilder.ts) — null means
  // "show every table" so pipelines aren't filtered until the user opens the
  // dropdown and unchecks something.
  const [visibleTables, setVisibleTables] = useState<Set<string> | null>(null);
  const [showTableFilter, setShowTableFilter] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Synchronize when pipeline prop changes (never auto-select node on enter or change)
  React.useEffect(() => {
    setNodes(pipeline.nodes);
    setEdges(pipeline.edges);
    setSelectedNode(null);
    setVisibleTables(null);
    setShowTableFilter(false);
  }, [pipeline.id]);

  const bronzeTableTitles: string[] = nodes.filter(n => n.type === 'bronze').map((n): string => n.title);
  const bronzeTableNames: string[] = Array.from(new Set<string>(bronzeTableTitles)).sort();
  const isTableVisible = (table: string) => visibleTables === null || visibleTables.has(table);
  const isNodeVisible = (node: CanvasNode) => node.type !== 'bronze' || isTableVisible(node.title);

  // Passo 1 (nó "source") reflete o status REAL da última sincronização Airbyte
  // (ver applyRealMetrics em pipelineBuilder.ts — 'idle' = nunca rodou, 'running' =
  // sincronizando agora). Enquanto essa carga na raw não tiver rodado ao menos uma
  // vez, ou estiver em execução, a construção das camadas seguintes (Bronze/Silver/
  // Gold) fica bloqueada — não faz sentido processar dados que ainda não chegaram.
  const sourceNode = nodes.find(n => n.type === 'source');
  const rawSyncStatus = sourceNode?.status ?? 'idle';
  const rawSyncBlocked = rawSyncStatus === 'idle' || rawSyncStatus === 'running';

  // Esse status só é atualizado quando o app carrega (App.tsx busca o histórico
  // real do Airbyte uma vez) — sem isto, ele fica travado em "running" mesmo
  // depois que a sincronização real termina, até a página ser recarregada.
  // Consulta o Airbyte direto (sem passar pelo pipeline_runs/Supabase) e
  // atualiza só o nó "source"; local (setNodes) + propagado pro pai (onUpdatePipeline).
  const [isRefreshingSync, setIsRefreshingSync] = useState(false);
  const refreshSourceSyncStatus = React.useCallback(async () => {
    if (!pipeline.airbyteConnectionId) return;
    setIsRefreshingSync(true);
    try {
      const jobs = await fetchConnectionJobs(pipeline.airbyteConnectionId, 1);
      if (!jobs.length) return;
      const newStatus = mapSyncStatusToNodeStatus(jobs[0].status);
      setNodes(prev => {
        const current = prev.find(n => n.type === 'source');
        if (!current || current.status === newStatus) return prev;
        const updated = prev.map(n => n.type === 'source' ? { ...n, status: newStatus } : n);
        onUpdatePipeline({ ...pipeline, nodes: updated });
        return updated;
      });
    } catch (err) {
      console.error('Falha ao atualizar o status da sincronização:', err);
    } finally {
      setIsRefreshingSync(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.airbyteConnectionId]);

  // Enquanto a Raw estiver sincronizando, verifica periodicamente se já terminou —
  // sem isso, o bloqueio das camadas seguintes nunca se desfaz sozinho.
  React.useEffect(() => {
    if (rawSyncStatus !== 'running') return;
    const interval = setInterval(refreshSourceSyncStatus, 10000);
    return () => clearInterval(interval);
  }, [rawSyncStatus, refreshSourceSyncStatus]);

  const toggleTableVisible = (table: string) => {
    setVisibleTables(prev => {
      const base = new Set(prev ?? bronzeTableNames);
      if (base.has(table)) base.delete(table); else base.add(table);
      return base;
    });
  };

  const getNodeIcon = (iconName: string, type: NodeType) => {
    switch (iconName) {
      case 'Database': return <Database className="w-5 h-5 text-blue-600" />;
      case 'Boxes': return <Boxes className="w-5 h-5 text-teal-600" />;
      case 'Sparkles': return <Sparkles className="w-5 h-5 text-amber-500" />;
      case 'FolderArchive': return <FolderArchive className="w-5 h-5 text-amber-600" />;
      case 'Radio': return <Radio className="w-5 h-5 text-purple-500" />;
      case 'Server': return <Server className="w-5 h-5 text-slate-700" />;
      case 'Globe': return <Globe className="w-5 h-5 text-emerald-500" />;
      case 'Layers': return <Layers className="w-5 h-5" />;
      case 'Lock': return <Lock className="w-5 h-5 text-rose-500" />;
      case 'Filter': return <Filter className="w-5 h-5 text-indigo-500" />;
      case 'ShieldCheck': return <ShieldCheck className="w-5 h-5 text-emerald-600" />;
      case 'Cpu': return <Cpu className="w-5 h-5 text-sky-500" />;
      default:
        if (type === 'source') return <Database className="w-5 h-5 text-blue-600" />;
        if (type === 'raw_data') return <FolderArchive className="w-5 h-5 text-amber-600" />;
        if (type === 'bronze') return <ShieldCheck className="w-5 h-5 text-orange-600" />;
        if (type === 'silver') return <Boxes className="w-5 h-5 text-teal-600" />;
        if (type === 'gold') return <Sparkles className="w-5 h-5 text-amber-500" />;
        if (type === 'lgpd_mask') return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
        if (type === 'destination') return <Boxes className="w-5 h-5 text-cyan-500" />;
        return <Cpu className="w-5 h-5 text-slate-500" />;
    }
  };

  const getNodeColorClass = (type: NodeType) => {
    switch (type) {
      case 'source': return 'border-blue-300 bg-blue-50 text-blue-700';
      case 'raw_data': return 'border-amber-300 bg-amber-50 text-amber-800';
      case 'bronze': return 'border-orange-300 bg-orange-50 text-orange-800';
      case 'silver': return 'border-teal-300 bg-teal-50 text-teal-800';
      case 'gold': return 'border-amber-300 bg-amber-50 text-amber-800';
      case 'lgpd_mask': return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'filter': return 'border-indigo-200 bg-indigo-50 text-indigo-700';
      case 'transform': return 'border-sky-200 bg-sky-50 text-sky-700';
      case 'aggregate': return 'border-violet-200 bg-violet-50 text-violet-700';
      case 'destination': return 'border-cyan-200 bg-cyan-50 text-cyan-700';
      default: return 'border-slate-200 bg-slate-50 text-slate-700';
    }
  };

  const handleMouseDown = (e: React.MouseEvent, node: CanvasNode) => {
    e.stopPropagation();
    setSelectedNode(node);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    setDragDistance(0);
    if (!canEdit) return;
    setDraggedNodeId(node.id);
    setDragOffset({
      x: e.clientX - node.x,
      y: e.clientY - node.y
    });
  };

  const handleNodeClick = (e: React.MouseEvent, node: CanvasNode) => {
    e.stopPropagation();
    setSelectedNode(node);
    // When clicking a bronze, silver, or gold node, open the dbt SQL editor!
    if (dragDistance < 6 && isMedallionDbtNode(node)) {
      setBronzeBuild({ status: 'idle' });
      setDbtEditingNode(node);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    // Deselect if clicked directly on canvas background area
    const target = e.target as HTMLElement;
    if (
      target === canvasRef.current || 
      target.id === 'canvas-interactive-area' || 
      target.tagName === 'svg' ||
      target.classList.contains('canvas-background-area')
    ) {
      setSelectedNode(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStartPos) {
      const dist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
      setDragDistance(dist);
    }
    if (!draggedNodeId || !canEdit) return;
    const newX = Math.max(20, Math.min(1300, e.clientX - dragOffset.x));
    const newY = Math.max(20, Math.min(600, e.clientY - dragOffset.y));

    setNodes(prev => {
      const updated = prev.map(n => n.id === draggedNodeId ? { ...n, x: newX, y: newY } : n);
      return updated;
    });
  };

  const handleMouseUp = () => {
    if (draggedNodeId) {
      setDraggedNodeId(null);
      // Persist to parent
      onUpdatePipeline({
        ...pipeline,
        nodes,
        edges
      });
    }
  };

  const handleSaveDbtModel = (nodeId: string, updatedSql: string, modelName: string, materialization: string) => {
    const updatedNodes = nodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          config: {
            ...n.config,
            dbtSql: updatedSql,
            dbtModelName: modelName,
            dbtMaterialization: materialization as any,
            query: updatedSql
          }
        };
      }
      return n;
    });

    setNodes(updatedNodes);
    if (selectedNode && selectedNode.id === nodeId) {
      setSelectedNode({
        ...selectedNode,
        config: {
          ...selectedNode.config,
          dbtSql: updatedSql,
          dbtModelName: modelName,
          dbtMaterialization: materialization as any,
          query: updatedSql
        }
      });
    }

    onUpdatePipeline({
      ...pipeline,
      nodes: updatedNodes
    });
  };

  // Camada Bronze real (Fase 5): mirrors every table Airbyte replicated into
  // raw_ into the matching bronze_ dataset via the gateway's BigQuery route.
  // Manual trigger for now — not wired to run automatically after each sync.
  const handleBuildBronze = async (node: CanvasNode, fullRefresh = false) => {
    const bq = node.config.bigquery;
    if (!bq || bronzeBuild.status === 'running' || rawSyncBlocked) return;

    setBronzeBuild({ status: 'running' });
    try {
      const { results } = await buildBronzeLayer({ ...bq, fullRefresh });
      const failed = results.filter(r => r.status === 'error');
      const hasFailure = failed.length > 0;
      setBronzeBuild({
        status: hasFailure ? 'error' : 'done',
        results,
        error: hasFailure ? failed.map(r => `${r.table}: ${r.error}`).join(' | ') : undefined,
      });

      const newStatus = hasFailure ? 'error' : 'success';
      const updatedNodes = nodes.map(n => n.id === node.id ? { ...n, status: newStatus } : n);
      setNodes(updatedNodes);
      if (selectedNode && selectedNode.id === node.id) {
        setSelectedNode({ ...selectedNode, status: newStatus });
      }
      onUpdatePipeline({ ...pipeline, nodes: updatedNodes });
    } catch (err) {
      setBronzeBuild({ status: 'error', error: err instanceof Error ? err.message : 'Falha ao construir a camada Bronze.' });
    }
  };

  // Camada Silver real: mesmo mecanismo da Bronze, um único nó cobrindo todas as
  // tabelas selecionadas (ver bigquery.tables no nó silver em pipelineBuilder.ts).
  const handleBuildSilver = async (node: CanvasNode, fullRefresh = false) => {
    const bq = node.config.bigquery;
    if (!bq || silverBuild.status === 'running' || rawSyncBlocked) return;

    setSilverBuild({ status: 'running' });
    try {
      const { results } = await buildSilverLayer({ ...bq, fullRefresh });
      const failed = results.filter(r => r.status === 'error');
      const hasFailure = failed.length > 0;
      setSilverBuild({
        status: hasFailure ? 'error' : 'done',
        results,
        error: hasFailure ? failed.map(r => `${r.table}: ${r.error}`).join(' | ') : undefined,
      });

      const newStatus = hasFailure ? 'error' : 'success';
      const updatedNodes = nodes.map(n => n.id === node.id ? { ...n, status: newStatus } : n);
      setNodes(updatedNodes);
      if (selectedNode && selectedNode.id === node.id) {
        setSelectedNode({ ...selectedNode, status: newStatus });
      }
      onUpdatePipeline({ ...pipeline, nodes: updatedNodes });
    } catch (err) {
      setSilverBuild({ status: 'error', error: err instanceof Error ? err.message : 'Falha ao construir a camada Silver.' });
    }
  };

  // Aguarda o job de sync mais recente da conexão sair de 'running'/'pending',
  // consultando o Airbyte real a cada poucos segundos (mesmo endpoint do botão
  // "Atualizar Status"). Usado só dentro de handleExecutePipeline — não é o
  // polling de fundo (esse já existe em refreshSourceSyncStatus/useEffect acima).
  const waitForSyncToFinish = async (connectionId: string, timeoutMs = 10 * 60 * 1000): Promise<NodeStatus> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const jobs = await fetchConnectionJobs(connectionId, 1);
      if (jobs.length) {
        const mapped = mapSyncStatusToNodeStatus(jobs[0].status);
        if (mapped !== 'running') return mapped;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    return 'warning'; // timeout — nem sucesso nem falha confirmados
  };

  const setNodeStatusById = (nodeId: string, status: NodeStatus) => {
    setNodes(prev => {
      const updated = prev.map(n => n.id === nodeId ? { ...n, status } : n);
      onUpdatePipeline({ ...pipeline, nodes: updated });
      return updated;
    });
  };

  const setNodesStatusByType = (type: CanvasNode['type'], status: NodeStatus) => {
    setNodes(prev => {
      const updated = prev.map(n => n.type === type ? { ...n, status } : n);
      onUpdatePipeline({ ...pipeline, nodes: updated });
      return updated;
    });
  };

  // Executa o pipeline de verdade, de ponta a ponta: dispara a sincronização real
  // no Airbyte (carga da Raw), espera terminar, constrói a Bronze (todas as
  // tabelas) e, se der certo, constrói a Silver. Cada etapa só começa se a
  // anterior tiver sucesso — mesma regra de "camada bloqueada até a anterior
  // terminar" já aplicada aos botões manuais de build.
  const handleExecutePipeline = async () => {
    if (isExecutingPipeline || !canExecute) return;
    if (!pipeline.airbyteConnectionId) {
      setPipelineExecError('Este pipeline não tem uma conexão real no Airbyte — não é possível executar de verdade.');
      return;
    }

    setIsExecutingPipeline(true);
    setPipelineExecError(null);

    try {
      // 1) RAW — dispara o sync real e espera terminar
      setNodesStatusByType('source', 'running');
      await triggerAirbyteSync(pipeline.airbyteConnectionId);
      const rawResult = await waitForSyncToFinish(pipeline.airbyteConnectionId);
      setNodesStatusByType('source', rawResult);

      if (rawResult !== 'success') {
        setPipelineExecError(
          rawResult === 'warning'
            ? 'A sincronização da Raw não terminou a tempo (timeout) — execução interrompida.'
            : 'A sincronização da Raw falhou — execução interrompida.'
        );
        return;
      }

      // 2) BRONZE — constrói todas as tabelas de uma vez (um dbt build só)
      const bronzeNodes = nodes.filter(n => n.type === 'bronze' && n.config.bigquery);
      if (bronzeNodes.length > 0) {
        const bq = bronzeNodes[0].config.bigquery!;
        const allTables = bronzeNodes.flatMap(n => n.config.bigquery!.tables);
        setNodesStatusByType('bronze', 'running');
        setBronzeBuild({ status: 'running' });
        try {
          const { results } = await buildBronzeLayer({
            projectId: bq.projectId, rawDataset: bq.rawDataset, bronzeDataset: bq.bronzeDataset,
            tables: allTables, sistema: bq.sistema, location: bq.location,
          });
          const byTable = new Map(results.map(r => [r.table, r]));
          const failed = results.filter(r => r.status === 'error');
          setBronzeBuild({
            status: failed.length ? 'error' : 'done',
            results,
            error: failed.length ? failed.map(r => `${r.table}: ${r.error}`).join(' | ') : undefined,
          });
          setNodes(prev => {
            const updated = prev.map(n => {
              if (n.type !== 'bronze' || !n.config.bigquery) return n;
              const table = n.config.bigquery.tables[0];
              const r = byTable.get(table);
              return { ...n, status: (r?.status === 'ok' ? 'success' : 'error') as NodeStatus };
            });
            onUpdatePipeline({ ...pipeline, nodes: updated });
            return updated;
          });
          if (failed.length) {
            setPipelineExecError(`Falha ao construir a Bronze: ${failed.map(r => r.table).join(', ')} — execução interrompida.`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Falha ao construir a camada Bronze.';
          setBronzeBuild({ status: 'error', error: msg });
          setNodesStatusByType('bronze', 'error');
          setPipelineExecError(msg);
          return;
        }
      }

      // 3) SILVER — um único nó cobre todas as tabelas
      const silverNode = nodes.find(n => n.type === 'silver' && n.config.bigquery);
      if (silverNode) {
        const bq = silverNode.config.bigquery!;
        setNodeStatusById(silverNode.id, 'running');
        setSilverBuild({ status: 'running' });
        try {
          const { results } = await buildSilverLayer({
            projectId: bq.projectId, rawDataset: bq.rawDataset, bronzeDataset: bq.bronzeDataset,
            silverDataset: bq.silverDataset, tables: bq.tables, sistema: bq.sistema, location: bq.location,
          });
          const failed = results.filter(r => r.status === 'error');
          setSilverBuild({
            status: failed.length ? 'error' : 'done',
            results,
            error: failed.length ? failed.map(r => `${r.table}: ${r.error}`).join(' | ') : undefined,
          });
          setNodeStatusById(silverNode.id, failed.length ? 'error' : 'success');
          if (failed.length) {
            setPipelineExecError(`Falha ao construir a Silver: ${failed.map(r => r.table).join(', ')}.`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Falha ao construir a camada Silver.';
          setSilverBuild({ status: 'error', error: msg });
          setNodeStatusById(silverNode.id, 'error');
          setPipelineExecError(msg);
        }
      }
    } finally {
      setIsExecutingPipeline(false);
    }
  };

  const handleAddOperator = (op: typeof AVAILABLE_OPERATORS[0]) => {
    const lastNode = nodes[nodes.length - 1];
    const newX = lastNode ? lastNode.x + 240 : 150;
    const newY = lastNode ? lastNode.y : 180;
    const newNodeId = `node-${Date.now()}`;

    const newNode: CanvasNode = {
      id: newNodeId,
      type: op.type as NodeType,
      title: op.name,
      subtitle: op.type === 'lgpd_mask' ? 'Proteção PII Ativa' :
                op.type === 'raw_data' ? 'Landing Zone Imutável' :
                op.type === 'bronze' ? 'Validação & Deduplicação' :
                op.type === 'silver' ? 'Dados Curados & Analíticos' : 'Configuração Padrão',
      provider: 'generic',
      iconName: op.icon,
      x: newX,
      y: newY,
      status: 'idle',
      config: op.type === 'lgpd_mask' ? {
        maskingRules: [
          { field: 'cpf', piiType: 'cpf', method: 'partial_redact' },
          { field: 'email', piiType: 'email', method: 'sha256_hash' }
        ]
      } : op.type === 'raw_data' ? {
        tableOrBucket: 's3://corp-lakehouse-raw/landing/',
        format: 'Snappy Parquet'
      } : op.type === 'bronze' ? {
        query: 'VALIDATE SCHEMA & DEDUPLICATE',
        maskingRules: [
          { field: 'cpf', piiType: 'cpf', method: 'anonymize' }
        ]
      } : op.type === 'silver' ? {
        destinationTable: 'dw_curated.tabela_analitica',
        writeMode: 'merge_upsert'
      } : {
        filterCondition: 'status == "ATIVO"'
      },
      metrics: {
        recordsIn: 0,
        recordsOut: 0,
        durationMs: 0
      }
    };

    const newNodes = [...nodes, newNode];
    let newEdges = [...edges];

    // Link previous node to new node if exists
    if (lastNode) {
      newEdges.push({
        id: `edge-${lastNode.id}-${newNodeId}`,
        source: lastNode.id,
        target: newNodeId,
        animated: true
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNode(newNode);
    setShowAddDrawer(false);

    onUpdatePipeline({
      ...pipeline,
      nodes: newNodes,
      edges: newEdges
    });
  };

  const handleAddConnector = (conn: typeof AVAILABLE_CONNECTORS[0]) => {
    const lastNode = nodes[nodes.length - 1];
    const newX = lastNode ? lastNode.x + 240 : 150;
    const newY = lastNode ? lastNode.y : 180;
    const newNodeId = `node-${Date.now()}`;

    const newNode: CanvasNode = {
      id: newNodeId,
      type: conn.type as NodeType,
      title: conn.name,
      subtitle: conn.category,
      provider: conn.provider as any,
      iconName: conn.icon,
      x: newX,
      y: newY,
      status: 'idle',
      config: {
        connector: conn.name,
        tableOrBucket: 'analytics_db.tabela_dados',
        format: 'JSON/Parquet'
      },
      metrics: {
        recordsIn: 0,
        recordsOut: 0,
        durationMs: 0
      }
    };

    const newNodes = [...nodes, newNode];
    let newEdges = [...edges];

    if (lastNode) {
      newEdges.push({
        id: `edge-${lastNode.id}-${newNodeId}`,
        source: lastNode.id,
        target: newNodeId,
        animated: true
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNode(newNode);
    setShowAddDrawer(false);

    onUpdatePipeline({
      ...pipeline,
      nodes: newNodes,
      edges: newEdges
    });
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!canEdit) return;
    const newNodes = nodes.filter(n => n.id !== nodeId);
    const newEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    setNodes(newNodes);
    setEdges(newEdges);
    if (selectedNode?.id === nodeId) {
      setSelectedNode(null);
    }
    onUpdatePipeline({
      ...pipeline,
      nodes: newNodes,
      edges: newEdges
    });
  };

  const handleUpdateNodeConfig = (nodeId: string, updatedConfig: any, title?: string) => {
    const newNodes = nodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          title: title || n.title,
          config: { ...n.config, ...updatedConfig }
        };
      }
      return n;
    });

    setNodes(newNodes);
    if (selectedNode?.id === nodeId) {
      setSelectedNode({
        ...selectedNode,
        title: title || selectedNode.title,
        config: { ...selectedNode.config, ...updatedConfig }
      });
    }

    onUpdatePipeline({
      ...pipeline,
      nodes: newNodes
    });
  };

  return (
    <div id="visual-canvas-container" className="flex flex-col h-[calc(100vh-140px)] bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs relative">
      {/* Top Toolbar */}
      <div id="canvas-toolbar" className="min-h-[52px] bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2.5 z-20">
        {/* Left: Mode badge + table filter */}
        <div id="canvas-mode-card" className="flex items-center gap-2 shrink-0 relative">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            <span className="text-slate-700 font-medium whitespace-nowrap">
              Modo: <strong className="text-slate-900 font-semibold">{pipeline.mode === 'streaming' ? 'Streaming Contínuo' : 'Batch Agendado'}</strong>
            </span>
          </div>

          {/* Filtro de tabelas — cada tabela vira seu próprio nó Bronze (ver
              pipelineBuilder.ts); com muitas tabelas o canvas fica poluído, então
              isso deixa marcar só as que devem aparecer. */}
          {bronzeTableNames.length > 0 && (
            <div className="relative">
              <button
                type="button"
                id="btn-table-filter"
                onClick={() => setShowTableFilter(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs border whitespace-nowrap ${
                  showTableFilter || visibleTables !== null
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>
                  Tabelas ({visibleTables === null ? bronzeTableNames.length : visibleTables.size}/{bronzeTableNames.length})
                </span>
                <ChevronRight className={`w-3 h-3 transition-transform ${showTableFilter ? 'rotate-90' : ''}`} />
              </button>

              {showTableFilter && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowTableFilter(false)} />
                  <div
                    id="table-filter-dropdown"
                    className="absolute left-0 top-full mt-1.5 w-64 max-h-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-40 flex flex-col overflow-hidden"
                  >
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tabelas no canvas</span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setVisibleTables(new Set())}
                          className="text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Nenhuma
                        </button>
                        <span className="text-slate-300">•</span>
                        <button
                          type="button"
                          onClick={() => setVisibleTables(null)}
                          className="text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                        >
                          Todas
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto py-1">
                      {bronzeTableNames.map(table => (
                        <label
                          key={table}
                          className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isTableVisible(table)}
                            onChange={() => toggleTableVisible(table)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className="font-mono truncate">{table}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: Toolbar Controls (Zoom + DAG + Run) */}
        <div id="canvas-toolbar-controls" className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Zoom controls */}
          <div id="canvas-zoom-card" className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 shadow-2xs shrink-0">
            <button 
              id="btn-zoom-out"
              onClick={() => setZoom(z => Math.max(0.6, z - 0.1))} 
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded transition cursor-pointer"
              title="Reduzir Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs px-2 text-slate-700 font-mono select-none font-medium">{Math.round(zoom * 100)}%</span>
            <button 
              id="btn-zoom-in"
              onClick={() => setZoom(z => Math.min(1.4, z + 0.1))} 
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded transition cursor-pointer"
              title="Aumentar Zoom"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button 
              id="btn-zoom-reset"
              onClick={() => setZoom(1)} 
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded transition cursor-pointer"
              title="Resetar Zoom (100%)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Manual refresh: checa o Airbyte agora, sem esperar o próximo poll/reload */}
          {pipeline.airbyteConnectionId && (
            <button
              id="btn-refresh-sync-status"
              onClick={refreshSourceSyncStatus}
              disabled={isRefreshingSync}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs shrink-0 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
              title="Verificar agora se a sincronização da Raw já terminou"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSync ? 'animate-spin' : ''}`} />
              <span>Atualizar Status</span>
            </button>
          )}

          {/* Code/DAG Export */}
          <button
            id="btn-export-dag"
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs shrink-0 whitespace-nowrap"
            title="Exportar DAG Airflow / PySpark"
          >
            <Code2 className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden md:inline">Exportar DAG</span>
            <span className="md:hidden">DAG</span>
          </button>

          {/* Execute Pipeline — dispara o fluxo real: sync Airbyte (Raw) -> Bronze -> Silver */}
          <button
            id="btn-run-pipeline"
            onClick={handleExecutePipeline}
            disabled={isExecutingPipeline || !canExecute}
            title="Executa de verdade: sincroniza a Raw no Airbyte, depois constrói a Bronze e a Silver via dbt"
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer shadow-2xs shrink-0 whitespace-nowrap ${
              isExecutingPipeline
                ? 'bg-amber-100 text-amber-800 border border-amber-300 cursor-wait'
                : canExecute
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            }`}
          >
            {isExecutingPipeline ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
                <span>Executando...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Executar Pipeline</span>
              </>
            )}
          </button>
        </div>
      </div>

      {pipelineExecError && (
        <div className="mx-4 mb-2 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{pipelineExecError}</span>
          <button
            type="button"
            onClick={() => setPipelineExecError(null)}
            className="text-rose-500 hover:text-rose-700 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Studio Area */}
      <div 
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="flex-1 relative overflow-auto bg-[#f1f5f9] select-none canvas-background-area"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      >
        {/* Interactive Canvas Transform Area */}
        <div 
          id="canvas-interactive-area"
          onClick={handleCanvasClick}
          className="absolute inset-0 transition-transform duration-75 origin-top-left canvas-background-area"
          style={{ transform: `scale(${zoom})`, width: '2000px', height: '1000px' }}
        >
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <linearGradient id="edgeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="50%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>

            {edges.map((edge) => {
              const srcNode = nodes.find(n => n.id === edge.source);
              const tgtNode = nodes.find(n => n.id === edge.target);
              if (!srcNode || !tgtNode) return null;
              if (!isNodeVisible(srcNode) || !isNodeVisible(tgtNode)) return null;

              // Compute port coordinates (Right center of source -> Left center of target)
              const x1 = srcNode.x + 220;
              const y1 = srcNode.y + 44;
              const x2 = tgtNode.x;
              const y2 = tgtNode.y + 44;

              const dx = Math.abs(x2 - x1) * 0.5;
              const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

              const isEdgeActive = srcNode.status === 'running';

              return (
                <g key={edge.id}>
                  {/* Outer glow line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isEdgeActive ? '#6366f1' : '#94a3b8'}
                    strokeWidth={isEdgeActive ? '3' : '2'}
                    strokeDasharray={edge.animated ? '6 4' : 'none'}
                    className={isEdgeActive ? 'animate-pulse' : ''}
                  />

                  {/* Flow dots if simulating or streaming */}
                  {(isEdgeActive || pipeline.mode === 'streaming') && (
                    <circle r="4" fill="#4f46e5" className="filter drop-shadow-[0_0_4px_#6366f1]">
                      <animateMotion path={pathD} dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Interactive Pipeline Nodes */}
          {nodes.map((node) => {
            if (!isNodeVisible(node)) return null;
            const isSelected = selectedNode?.id === node.id;
            const isRunningNow = node.status === 'running';

            return (
              <div
                key={node.id}
                id={`canvas-node-${node.id}`}
                onMouseDown={(e) => handleMouseDown(e, node)}
                onClick={(e) => handleNodeClick(e, node)}
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
                className={`absolute w-56 rounded-xl border p-3.5 shadow-md transition-all cursor-grab active:cursor-grabbing z-10 ${
                  isSelected 
                    ? 'ring-2 ring-indigo-600 border-indigo-600 shadow-xl shadow-indigo-100 bg-white' 
                    : 'bg-white hover:border-slate-400 border-slate-200'
                } ${isRunningNow ? 'ring-2 ring-amber-500 border-amber-500 shadow-lg shadow-amber-100 animate-pulse' : ''}`}
              >
                {/* Node Top Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg border ${getNodeColorClass(node.type)}`}>
                      {getNodeIcon(node.iconName, node.type)}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        {node.type === 'source' ? '1. Source (Origem)' :
                         node.type === 'raw_data' ? '2. Raw Data (Landing)' :
                         node.type === 'bronze' ? '3. Camada Bronze' :
                         node.type === 'silver' ? '4. Camada Silver' :
                         node.type === 'gold' ? '5. Camada Gold' :
                         node.type === 'lgpd_mask' ? 'Segurança LGPD' :
                         node.type === 'destination' ? 'Destino DW' : node.type}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 truncate max-w-[130px]" title={node.title}>
                        {node.title}
                      </h4>
                    </div>
                  </div>

                  {/* Status Indicator */}
                  <div>
                    {node.status === 'success' && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                    {node.status === 'running' && <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />}
                    {node.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}
                    {node.status === 'idle' && <span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" />}
                  </div>
                </div>

                {/* Subtitle / Key Info */}
                <p className="text-[11px] text-slate-500 truncate mb-2 font-mono" title={node.subtitle}>
                  {node.subtitle}
                </p>

                {/* Step Architectural Badges */}
                {node.type === 'source' && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-blue-50 border border-blue-200 px-2 py-1 rounded text-blue-800">
                    <span className="flex items-center gap-1 font-semibold truncate">
                      <Database className="w-3 h-3 text-blue-600 shrink-0" />
                      Origem dos Dados
                    </span>
                    <span className="text-blue-700 font-mono text-[9px] font-bold shrink-0">Passo 1</span>
                  </div>
                )}

                {node.type === 'raw_data' && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-amber-50 border border-amber-200 px-2 py-1 rounded text-amber-800">
                    <span className="flex items-center gap-1 font-semibold truncate">
                      <FolderArchive className="w-3 h-3 text-amber-600 shrink-0" />
                      Landing Imutável (CDC)
                    </span>
                    <span className="text-amber-700 font-mono text-[9px] font-bold shrink-0">Passo 2</span>
                  </div>
                )}

                {node.type === 'bronze' && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-orange-50 border border-orange-200 px-2 py-1 rounded text-orange-800">
                    <span className="flex items-center gap-1 font-semibold truncate">
                      <ShieldCheck className="w-3 h-3 text-orange-600 shrink-0" />
                      Validação & Higienização
                    </span>
                    <span className="text-orange-700 font-mono text-[9px] font-bold shrink-0">Passo 3</span>
                  </div>
                )}

                {node.type === 'silver' && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-teal-50 border border-teal-200 px-2 py-1 rounded text-teal-800">
                    <span className="flex items-center gap-1 font-semibold truncate">
                      <Boxes className="w-3 h-3 text-teal-600 shrink-0" />
                      Curado • Analytics & BI
                    </span>
                    <span className="text-teal-700 font-mono text-[9px] font-bold shrink-0">Passo 4</span>
                  </div>
                )}

                {node.type === 'gold' && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-amber-50 border border-amber-200 px-2 py-1 rounded text-amber-800">
                    <span className="flex items-center gap-1 font-semibold truncate">
                      <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                      Data Marts & KPIs
                    </span>
                    <span className="text-amber-700 font-mono text-[9px] font-bold shrink-0">Passo 5</span>
                  </div>
                )}

                {/* Bloqueado até a carga da Raw (Passo 1) rodar ao menos uma vez com sucesso */}
                {rawSyncBlocked && (node.type === 'bronze' || node.type === 'silver' || node.type === 'gold') && (
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] bg-slate-100 border border-slate-300 px-2 py-1 rounded text-slate-600 font-semibold">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      {rawSyncStatus === 'running' ? 'Aguardando sincronização da Raw...' : 'Bloqueado — Raw ainda não sincronizada'}
                    </span>
                  </div>
                )}

                {/* LGPD Badge on Node if LGPD node */}
                {node.type === 'lgpd_mask' && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-emerald-50 border border-emerald-200 px-2 py-1 rounded text-emerald-800">
                    <span className="flex items-center gap-1 font-semibold">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      {node.config.maskingRules?.length || 3} Campos Criptografados
                    </span>
                    <span className="text-emerald-700 font-mono text-[9px] font-bold">Art. 46</span>
                  </div>
                )}

                {/* Clickable dbt SQL Editor badge for Bronze, Silver, Gold nodes */}
                {isMedallionDbtNode(node) && (
                  <button
                    type="button"
                    id={`btn-node-dbt-${node.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(node);
                      setDbtEditingNode(node);
                    }}
                    className="mt-2 w-full flex items-center justify-between text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-100 border border-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer shadow-xs group"
                    title="Abrir Editor dbt SQL para editar código gerado automaticamente"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 rounded bg-[#FF694B] text-white flex items-center justify-center text-[8px] font-mono font-bold leading-none shrink-0">
                        dbt
                      </span>
                      <span className="font-semibold text-slate-200">Editor SQL dbt</span>
                    </div>
                    <Code2 className="w-3.5 h-3.5 text-[#FF694B] group-hover:scale-110 transition-transform" />
                  </button>
                )}

                {/* Input and Output Ports */}
                <div 
                  className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-400 hover:border-indigo-600 shadow-2xs"
                  title="Entrada (Port In)" 
                />
                <div 
                  className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-400 hover:border-emerald-600 shadow-2xs"
                  title="Saída (Port Out)" 
                />

                {/* Micro Throughput bar */}
                {node.metrics && node.metrics.recordsIn > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                    <span>In: {(node.metrics.recordsIn / 1000).toFixed(0)}k</span>
                    <span className="text-slate-700 font-mono font-medium">{node.metrics.durationMs}ms</span>
                    <span>Out: {(node.metrics.recordsOut / 1000).toFixed(0)}k</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Floating Quick Help - 5 Passos Lakehouse & dbt Indicator */}
        <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-xs border border-slate-200 px-3.5 py-2 rounded-xl text-xs text-slate-700 shadow-md flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <span>1. Source</span>
          </div>
          <span className="text-slate-300">➔</span>
          <div className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>2. Raw</span>
          </div>
          <span className="text-slate-300">➔</span>
          <div className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
            <span>3. Bronze (dbt)</span>
          </div>
          <span className="text-slate-300">➔</span>
          <div className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-600" />
            <span>4. Silver (dbt)</span>
          </div>
          <span className="text-slate-300">➔</span>
          <div className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600" />
            <span>5. Gold (dbt)</span>
          </div>
          <div className="hidden lg:flex items-center gap-1 pl-2 border-l border-slate-200 text-slate-500 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-[#FF694B]" />
            <span>Clique em nós Bronze, Silver ou Gold para abrir o Editor dbt SQL</span>
          </div>
        </div>
      </div>

      {/* Right-hand Node Inspector & Config Drawer.
          Nós das camadas Bronze, Silver e Gold não exibem este painel de configuração:
          ao serem clicados abrem diretamente o Editor/Visualizador dbt SQL. */}
      {selectedNode && !isMedallionDbtNode(selectedNode) && (
        <div id="node-config-drawer" className="absolute right-0 top-14 bottom-0 w-80 sm:w-96 bg-white border-l border-slate-200 p-5 overflow-y-auto shadow-2xl z-20 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg border ${getNodeColorClass(selectedNode.type)}`}>
                {getNodeIcon(selectedNode.iconName, selectedNode.type)}
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Configuração de Nó
                </span>
                <h3 className="text-sm font-bold text-slate-900">{selectedNode.title}</h3>
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4 flex-1 text-xs">
            {/* Title / Label */}
            <div>
              <label className="block text-slate-500 font-semibold mb-1">Nome do Componente</label>
              <input
                type="text"
                value={selectedNode.title}
                disabled={!canEdit}
                onChange={(e) => handleUpdateNodeConfig(selectedNode.id, {}, e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition"
              />
            </div>

            {/* Provider badge */}
            <div>
              <label className="block text-slate-500 font-semibold mb-1">Provedor Cloud / Runtime</label>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 uppercase font-mono text-[11px] flex items-center justify-between">
                <span className="font-semibold">{selectedNode.provider.toUpperCase()}</span>
                <span className="text-emerald-700 font-sans normal-case font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Conectado via TLS 1.3
                </span>
              </div>
            </div>

            {/* dbt SQL Model Section in Inspector Drawer */}
            {isMedallionDbtNode(selectedNode) && (
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700 rounded-xl p-3.5 text-white space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-[#FF694B] text-white flex items-center justify-center font-bold text-[10px] font-mono shadow-xs">
                      dbt
                    </div>
                    <div>
                      <span className="font-bold text-xs block text-white">Modelo SQL dbt</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        models/{getDbtLayer(selectedNode)}/{selectedNode.config.dbtModelName || `${getDbtLayer(selectedNode)}_${selectedNode.title.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`}.sql
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                    {selectedNode.config.dbtSql ? 'Personalizado' : 'Auto-Gerado'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Código SQL dbt gerado automaticamente pela plataforma. Você pode visualizar e editar as macros Jinja, schemas e deduplicação CDC.
                </p>

                <button
                  type="button"
                  id="btn-open-dbt-editor-from-drawer"
                  onClick={() => setDbtEditingNode(selectedNode)}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#FF694B] hover:bg-[#ff5633] text-white font-bold text-xs transition cursor-pointer shadow-md shadow-orange-950/40"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Abrir Editor SQL dbt</span>
                </button>
              </div>
            )}

            {/* LGPD Masking Specific Configuration */}
            {selectedNode.type === 'lgpd_mask' && (
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Regras de Sanitização LGPD
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded font-mono font-bold">
                    Art. 13 & 46
                  </span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Os campos abaixo são interceptados na memória do pipeline e nunca chegam ao destino em texto claro.
                </p>

                {/* List of rules */}
                <div className="space-y-2">
                  {(selectedNode.config.maskingRules || [
                    { field: 'cpf_titular', piiType: 'cpf' as PIIType, method: 'partial_redact' as MaskingMethod },
                    { field: 'numero_cartao', piiType: 'credit_card' as PIIType, method: 'sha256_hash' as MaskingMethod },
                    { field: 'email_comprador', piiType: 'email' as PIIType, method: 'tokenization' as MaskingMethod }
                  ]).map((rule, idx) => (
                    <div key={idx} className="bg-white border border-emerald-200/80 p-2.5 rounded-lg space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-slate-900 font-semibold">{rule.field}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold uppercase">
                          {rule.piiType}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Método:</span>
                        <span className="text-indigo-600 font-mono font-semibold">
                          {rule.method === 'sha256_hash' ? 'Hash Criptográfico SHA-256' :
                           rule.method === 'partial_redact' ? 'Redação Parcial (***.195.***-72)' :
                           rule.method === 'tokenization' ? 'Token Vault Interoperável' : 'Anonimização Total'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 text-[10px] text-slate-500 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Chaves de cifragem gerenciadas por HSM em conformidade com a ANPD.</span>
                </div>
              </div>
            )}

            {/* Filter Configuration */}
            {selectedNode.type === 'filter' && (
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Expressão do Filtro (SQL Predicate)</label>
                <textarea
                  rows={3}
                  disabled={!canEdit}
                  value={selectedNode.config.filterCondition || 'status IN ("PAID", "APPROVED")'}
                  onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { filterCondition: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>
            )}

            {/* Transform SQL Configuration */}
            {selectedNode.type === 'transform' && (
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Query SQL / Spark Transformation</label>
                <textarea
                  rows={4}
                  disabled={!canEdit}
                  value={selectedNode.config.query || 'SELECT t.*, cep.estado FROM stream t JOIN cep_ref ON t.cep = cep_ref.cep'}
                  onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { query: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>
            )}

            {/* Raw Data (Landing Zone) Configuration */}
            {selectedNode.type === 'raw_data' && (
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 flex items-center gap-1.5">
                    <FolderArchive className="w-4 h-4 text-amber-600" />
                    2. Raw Data (Landing Zone Imutável)
                  </span>
                  <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-mono font-bold">
                    Append-Only
                  </span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Zona de aterrissagem dos dados em estado bruto com carimbo temporal e metadados CDC (_op, _source_ts, _ingested_at).
                </p>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1 text-xs">Caminho do Bucket / Object Storage</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={selectedNode.config.tableOrBucket || 's3://corp-lakehouse-raw/staging/'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { tableOrBucket: e.target.value })}
                    className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-slate-900 font-mono text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-white rounded-lg border border-amber-200">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Formato</div>
                    <div className="font-bold text-slate-800 font-mono mt-0.5">Snappy Parquet</div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-amber-200">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Auditoria CDC</div>
                    <div className="font-bold text-emerald-700 font-mono mt-0.5">Ativa (_source_ts)</div>
                  </div>
                </div>
              </div>
            )}

            {/* Bronze Layer Configuration */}
            {selectedNode.type === 'bronze' && (
              <div className="bg-orange-50/70 border border-orange-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-orange-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-orange-600" />
                    3. Camada Bronze (Validação & LGPD)
                  </span>
                  <span className="text-[10px] bg-orange-100 text-orange-800 border border-orange-200 px-2 py-0.5 rounded font-mono font-bold">
                    Delta / Iceberg
                  </span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Aplica tipagem estrita, deduplicação por chave primária e filtros de integridade, além de anonimização conforme LGPD.
                </p>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1 text-xs">Regra de Validação / Schema Enforcement</label>
                  <textarea
                    rows={2}
                    disabled={!canEdit}
                    value={selectedNode.config.query || 'VALIDATE SCHEMA & DEDUPLICATE (id_origem)'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { query: e.target.value })}
                    className="w-full bg-white border border-orange-200 rounded-lg p-2.5 font-mono text-xs text-slate-900"
                  />
                </div>
                {selectedNode.config.maskingRules && selectedNode.config.maskingRules.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-bold text-orange-900 flex items-center justify-between">
                      <span>Cifragem LGPD Ativa ({selectedNode.config.maskingRules.length} campos)</span>
                      <span className="text-[10px] text-emerald-700 font-mono font-semibold">Art. 46</span>
                    </div>
                    {selectedNode.config.maskingRules.map((r, i) => (
                      <div key={i} className="bg-white p-2 rounded-lg border border-orange-200 flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-slate-800">{r.field}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold uppercase">{r.method}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Silver Layer Configuration */}
            {selectedNode.type === 'silver' && (
              <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-teal-900 flex items-center gap-1.5">
                    <Boxes className="w-4 h-4 text-teal-600" />
                    4. Camada Silver (Curadoria Analítica)
                  </span>
                  <span className="text-[10px] bg-teal-100 text-teal-800 border border-teal-200 px-2 py-0.5 rounded font-mono font-bold">
                    Analytics-Ready
                  </span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Tabelas curadas, enriquecidas e normalizadas, prontas para consultas analíticas de alta performance e visualizações no BI.
                </p>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1 text-xs">Tabela Analítica no DW</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={selectedNode.config.destinationTable || selectedNode.config.tableOrBucket || 'dw_corp.vendas_analitico'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { destinationTable: e.target.value })}
                    className="w-full bg-white border border-teal-200 rounded-lg px-3 py-2 text-slate-900 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {/* Gold Layer Configuration */}
            {(selectedNode.type === 'gold' || (selectedNode.title || '').toLowerCase().includes('gold')) && (
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    5. Camada Gold (Data Marts & KPIs)
                  </span>
                  <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-mono font-bold">
                    Executive-Ready
                  </span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Agregações executivas, métricas de negócio consolidadas e dimensões analíticas em estrela prontas para dashboards e relatórios da diretoria.
                </p>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1 text-xs">Tabela / Data Mart de Destino</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={selectedNode.config.destinationTable || selectedNode.config.tableOrBucket || 'gold_marts.kpis_executivos_vendas'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { destinationTable: e.target.value })}
                    className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-slate-900 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1 text-xs">Materialização dbt</label>
                  <select
                    disabled={!canEdit}
                    value={selectedNode.config.dbtMaterialization || 'table'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { dbtMaterialization: e.target.value as any })}
                    className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-slate-900 text-xs"
                  >
                    <option value="table">table (Tabela Física - Recomendado para BI)</option>
                    <option value="view">view (Visão Virtual em Tempo Real)</option>
                    <option value="incremental">incremental (Cargas Micro-batch)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Source / Destination Table Configuration */}
            {(selectedNode.type === 'source' || selectedNode.type === 'destination') && (
              <div className="space-y-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Conector Selecionado</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={selectedNode.config.connector || 'Cloud Connector'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { connector: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">
                    {selectedNode.type === 'source' ? 'Tabela Origem / Tópico' : 'Tabela Destino'}
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={selectedNode.config.tableOrBucket || selectedNode.config.destinationTable || 'analytics_db.tabela'}
                    onChange={(e) => handleUpdateNodeConfig(selectedNode.id, { tableOrBucket: e.target.value, destinationTable: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Metrics Breakdown */}
            {selectedNode.metrics && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 block">Métricas de Execução</span>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white border border-slate-200 p-2 rounded shadow-2xs">
                    <span className="text-[10px] text-slate-500 block font-medium">Entrada</span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedNode.metrics.recordsIn.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-white border border-slate-200 p-2 rounded shadow-2xs">
                    <span className="text-[10px] text-slate-500 block font-medium">Saída</span>
                    <span className="font-mono font-bold text-emerald-600">
                      {selectedNode.metrics.recordsOut.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-white border border-slate-200 p-2 rounded shadow-2xs">
                    <span className="text-[10px] text-slate-500 block font-medium">Latência</span>
                    <span className="font-mono font-bold text-indigo-600">
                      {selectedNode.metrics.durationMs}ms
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Delete Node action */}
            {canEdit && (
              <div className="pt-4 border-t border-slate-200">
                <button
                  onClick={() => handleDeleteNode(selectedNode.id)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold transition cursor-pointer shadow-2xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remover Este Nó
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Component Drawer / Modal */}
      {showAddDrawer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">Catálogo de Conectores & Operadores</h3>
                <p className="text-xs text-slate-500">Selecione um componente para anexar ao pipeline ETL</p>
              </div>
              <button onClick={() => setShowAddDrawer(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Operators & Processors */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-600" /> Operadores & Sanitização LGPD
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {AVAILABLE_OPERATORS.map((op) => (
                    <div
                      key={op.id}
                      onClick={() => handleAddOperator(op)}
                      className="p-3 bg-white hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-xl cursor-pointer transition flex items-start gap-3 group shadow-2xs"
                    >
                      <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition">
                        {getNodeIcon(op.icon, op.type as NodeType)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-bold text-slate-900 group-hover:text-indigo-900">{op.name}</h5>
                          {op.type === 'lgpd_mask' && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold">
                              LGPD Art. 46
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 leading-normal">{op.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cloud Connectors */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600" /> Conectores de Nuvem (Origem & Destino)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {AVAILABLE_CONNECTORS.map((conn) => (
                    <div
                      key={conn.id}
                      onClick={() => handleAddConnector(conn)}
                      className="p-3 bg-white hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-xl cursor-pointer transition flex items-center gap-3 group shadow-2xs"
                    >
                      <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition">
                        {getNodeIcon(conn.icon, conn.type as NodeType)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-bold text-slate-900 group-hover:text-emerald-900">{conn.name}</h5>
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono font-medium">
                            {conn.type === 'source' ? 'Origem' : 'Destino'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500">{conn.category}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LGPD Data Preview Modal (Shows Raw vs Masked side by side) */}
      {showDataPreview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Inspetor de Conformidade LGPD (Dados Brutos vs Sanitizados)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Demonstração de proteção de Dados Pessoais Identificáveis (PII) durante a execução do pipeline
                  </p>
                </div>
              </div>
              <button onClick={() => setShowDataPreview(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Permission Banner */}
              {!canViewRawPII && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-xs text-amber-800">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>Controle de Acesso LGPD Ativo:</strong> Seu papel atual não possui permissão para visualizar dados brutos desmascarados. Apenas dados sanitizados e criptografados são exibidos.
                  </span>
                </div>
              )}

              {/* Two Column Comparison */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Before: Raw Data (Origem) */}
                <div className="bg-rose-50/40 border border-rose-200 rounded-xl p-4">
                  <div className="flex items-center justify-between pb-3 border-b border-rose-200 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600" /> 1. Origem: Dados Brutos (Contém PII)
                    </span>
                    <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-200 px-2 py-0.5 rounded font-mono font-bold">
                      Restrito / Confidencial
                    </span>
                  </div>

                  <div className="space-y-3 font-mono text-[11px]">
                    {MOCK_RAW_SAMPLE.map((row, i) => (
                      <div key={i} className="p-3 bg-white rounded-lg border border-rose-200 space-y-1 shadow-2xs">
                        <div className="text-slate-500 text-[10px]">ID: {row.id_transacao} | {row.timestamp}</div>
                        <div>
                          <span className="text-slate-500">Nome: </span>
                          <span className="text-rose-700 font-semibold">{canViewRawPII ? row.nome_comprador : '••••••••••••••••'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">CPF: </span>
                          <span className="text-rose-700 font-bold bg-rose-50 px-1 rounded border border-rose-200">{canViewRawPII ? row.cpf_titular : '***.***.***-**'}</span>
                          <span className="text-[9px] text-rose-600 ml-1.5">(PII Crítico)</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Cartão: </span>
                          <span className="text-rose-700 bg-rose-50 px-1 rounded border border-rose-200">{canViewRawPII ? row.numero_cartao : '•••• •••• •••• ••••'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">E-mail: </span>
                          <span className="text-slate-700">{canViewRawPII ? row.email_comprador : '••••@••••.com'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Valor: </span>
                          <span className="text-emerald-700 font-bold">R$ {row.valor.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* After: Sanitized Data (Destino BigQuery / Snowflake) */}
                <div className="bg-emerald-50/40 border border-emerald-200 rounded-xl p-4">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-200 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" /> 2. Destino: Sanitizado (Conforme LGPD)
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded font-mono font-bold">
                      Art. 7º & 13 Conformes
                    </span>
                  </div>

                  <div className="space-y-3 font-mono text-[11px]">
                    {MOCK_MASKED_SAMPLE.map((row, i) => (
                      <div key={i} className="p-3 bg-white rounded-lg border border-emerald-200 space-y-1 shadow-2xs">
                        <div className="text-slate-500 text-[10px]">ID: {row.id_transacao}</div>
                        <div>
                          <span className="text-slate-500">Nome: </span>
                          <span className="text-slate-800 font-medium">{row.nome_comprador}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">CPF: </span>
                          <span className="text-emerald-700 font-bold bg-emerald-50 px-1 rounded border border-emerald-200">{row.cpf_titular}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Cartão: </span>
                          <span className="text-emerald-700 break-all text-[10px] block bg-emerald-50 p-1 rounded mt-0.5 border border-emerald-200">
                            {row.numero_cartao}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">E-mail: </span>
                          <span className="text-indigo-600 font-medium">{row.email_comprador}</span>
                        </div>
                        <div className="pt-1 flex items-center justify-between text-[10px]">
                          <span className="text-slate-500">Região: {row.regiao} ({row.estado})</span>
                          <span className="text-emerald-700 font-bold">{row.compliance_lgpd}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowDataPreview(false)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer shadow-2xs"
              >
                Fechar Visualizador
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export DAG Modal (Airflow / PySpark / dbt) */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">Exportação de Código e DAG</h3>
                  <p className="text-xs text-slate-500">Apache Airflow DAG com Sanitizador LGPD nativo</p>
                </div>
              </div>
              <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs text-sky-300 overflow-x-auto shadow-inner">
                <pre>{`"""
Pipeline Auto-gerado pelo DataCore ETL Studio
Conformidade LGPD: Art. 7º V & Art. 46 (Criptografia e Pseudonimização)
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.providers.google.cloud.transfers.postgres_to_gcs import PostgresToGCSEmplateOperator
from airflow.providers.google.cloud.operators.bigquery import BigQueryInsertJobOperator
from dataflow_security.lgpd import PIIMaskingOperator

default_args = {
    'owner': '${pipeline.owner}',
    'depends_on_past': False,
    'start_date': datetime(2026, 9, 1),
    'email_on_failure': True,
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
    'lgpd_legal_basis': '${pipeline.legalBasis}',
}

with DAG(
    dag_id='${pipeline.id}',
    default_args=default_args,
    schedule_interval='${pipeline.cronExpression || "@continuous"}',
    catchup=False,
    tags=['etl', 'lgpd', '${pipeline.cloudProviders.join("', '")}']
) as dag:

    # 1. Ingestão da Origem
    extract_gateway = PostgresToGCSEmplateOperator(
        task_id='extract_postgres_gateway',
        sql="SELECT * FROM public.transacoes_checkout WHERE status = 'APROVADO';",
        bucket='corp-raw-landing-zone',
        filename='transacoes/{{ ds }}/batch.parquet'
    )

    # 2. Sanitização Estrita de PII (LGPD)
    mask_pii_lgpd = PIIMaskingOperator(
        task_id='apply_lgpd_masking',
        input_uri='gs://corp-raw-landing-zone/transacoes/{{ ds }}/batch.parquet',
        output_uri='gs://corp-anonymized-zone/transacoes/{{ ds }}/sanitized.parquet',
        rules={
            'cpf_titular': 'partial_redact',
            'numero_cartao': 'sha256_hash',
            'email_comprador': 'tokenization'
        },
        audit_dpo_log=True
    )

    # 3. Carga no Data Warehouse (BigQuery)
    load_bigquery = BigQueryInsertJobOperator(
        task_id='load_bigquery_dw',
        configuration={
            "query": {
                "query": "CREATE OR REPLACE TABLE analytics.faturamento_vendas AS SELECT * FROM EXTERNAL_OBJECT('gs://corp-anonymized-zone/transacoes/{{ ds }}/sanitized.parquet');",
                "useLegacySql": False,
            }
        }
    )

    extract_gateway >> mask_pii_lgpd >> load_bigquery
`}</pre>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(pipeline, null, 2));
                  alert('Definição JSON do pipeline copiada para a área de transferência!');
                }}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Download className="w-3.5 h-3.5" /> Copiar JSON
              </button>
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* dbt SQL Model Editor Modal for Bronze, Silver & Gold nodes */}
      {dbtEditingNode && (
        <DbtSqlEditorModal
          node={dbtEditingNode}
          pipeline={pipeline}
          canEdit={canEdit}
          onSave={handleSaveDbtModel}
          onClose={() => setDbtEditingNode(null)}
          canBuildBronze={canExecute && !rawSyncBlocked}
          canBuildSilver={canExecute && !rawSyncBlocked}
          rawSyncBlocked={rawSyncBlocked}
          rawSyncStatus={rawSyncStatus}
          bronzeBuild={bronzeBuild}
          silverBuild={silverBuild}
          onBuildBronze={(fullRefresh) => handleBuildBronze(dbtEditingNode, fullRefresh)}
          onBuildSilver={(fullRefresh) => handleBuildSilver(dbtEditingNode, fullRefresh)}
        />
      )}
    </div>
  );
};
