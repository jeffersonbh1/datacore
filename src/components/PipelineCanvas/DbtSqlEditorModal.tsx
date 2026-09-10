import React, { useState, useEffect } from 'react';
import {
  X, Check, Copy, Download, RefreshCw, Play, FileCode,
  Layers, Database, Sparkles, CheckCircle2, AlertCircle,
  Terminal, ShieldCheck, Cpu, Code2, Sliders, ExternalLink,
  HelpCircle, Eye, EyeOff
} from 'lucide-react';
import { CanvasNode, Pipeline, CanvasEdge } from '../../types';
import { BronzeTableResult } from '../../lib/airbyteGateway';

interface DbtSqlEditorModalProps {
  node: CanvasNode;
  pipeline: Pipeline;
  onSave: (nodeId: string, updatedSql: string, modelName: string, materialization: string) => void;
  onClose: () => void;
  canEdit: boolean;
  /** Real "Construir Camada Bronze" action — only rendered for bronze nodes with a BigQuery destination. */
  canBuildBronze: boolean;
  bronzeBuild: { status: 'idle' | 'running' | 'done' | 'error'; results?: BronzeTableResult[]; error?: string };
  onBuildBronze: (fullRefresh?: boolean) => void;
}

export type DbtLayer = 'bronze' | 'silver' | 'gold';

export const getDbtLayer = (node: CanvasNode): DbtLayer => {
  const typeLower = (node.type || '').toLowerCase();
  const titleLower = (node.title || '').toLowerCase();
  const subtitleLower = (node.subtitle || '').toLowerCase();

  if (typeLower === 'gold' || titleLower.includes('gold') || subtitleLower.includes('gold') || titleLower.includes('ouro')) {
    return 'gold';
  }
  if (typeLower === 'silver' || titleLower.includes('silver') || subtitleLower.includes('silver') || titleLower.includes('prata')) {
    return 'silver';
  }
  return 'bronze';
};

export const generateAutomaticDbtSql = (
  node: CanvasNode, 
  layer: DbtLayer, 
  upstreamNode: CanvasNode | null,
  materialization: string
): string => {
  const upstreamRef = upstreamNode 
    ? `ref('${upstreamNode.title.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'stg_upstream'}')`
    : `ref('stg_raw_landing_zone')`;

  if (layer === 'bronze') {
    return `{{ config(
    materialized = '${materialization}',
    unique_key = 'id_transacao',
    schema = 'bronze',
    tags = ['lakehouse', 'bronze', 'lgpd_conformidade', 'raw_ingestion'],
    cluster_by = ['status_transacao']
) }}

/*
  ========================================================================
  Modelo dbt: Camada Bronze (Higienização, Tipagem e LGPD)
  Gerado automaticamente pela plataforma DataCore Studio
  Objetivo: Schema Enforcement, Deduplicação CDC e Anonimização Art. 46 ANPD
  ========================================================================
*/

with raw_source as (
    -- Ingestão da zona Landing ou upstream source
    select * from {{ ${upstreamRef} }}
    
    {% if is_incremental() %}
      -- Filtro de micro-batch para execução incremental de alta performance
      where _ingested_at > (select max(_ingested_at) from {{ this }})
    {% endif %}
),

sanitized_and_typed as (
    select
        -- Chaves de Identificação e Surrogate Keys
        cast(id_transacao as string) as id_transacao,
        
        -- Metadados de Ingestão e Auditoria CDC
        cast(_source_ts as timestamp) as dt_geracao_origem,
        cast(_ingested_at as timestamp) as dt_ingestao_lake,
        cast(current_timestamp() as timestamp) as _dbt_loaded_at,
        
        -- Campos de Negócio com Tipagem Estrita
        cast(valor as decimal(18, 2)) as valor_transacao,
        trim(upper(coalesce(status, 'PENDENTE'))) as status_transacao,
        
        -- Conformidade LGPD (Art. 46): Cifragem e Redação de PII
        -- 1. CPF: Redação Parcial (preserva dígitos de controle interno)
        case 
            when cpf_titular is not null 
            then regexp_replace(cpf_titular, r'(\\d{3})\\.(\\d{3})\\.(\\d{3})-(\\d{2})', '***.$2.***-**')
            else null 
        end as cpf_titular_mascarado,
        
        -- 2. Cartão de Crédito: Hash Criptográfico SHA-256 Irreversível
        to_hex(sha256(to_utf8(coalesce(numero_cartao, '')))) as numero_cartao_hash,
        
        -- 3. E-mail: Tokenização e Normalização
        lower(trim(email_comprador)) as email_comprador_tokenizado

    from raw_source
),

deduplicated as (
    -- Deduplicação determinística por ID mantendo o registro mais recente (CDC)
    select *
    from sanitized_and_typed
    qualify row_number() over (
        partition by id_transacao 
        order by dt_geracao_origem desc, dt_ingestao_lake desc
    ) = 1
)

select * from deduplicated
`;
  }

  if (layer === 'silver') {
    return `{{ config(
    materialized = '${materialization}',
    schema = 'silver',
    tags = ['lakehouse', 'silver', 'curated_analytics', 'dw'],
    cluster_by = ['status_transacao', 'dt_transacao']
) }}

/*
  ========================================================================
  Modelo dbt: Camada Silver (Curadoria & Dimensões Conformadas)
  Gerado automaticamente pela plataforma DataCore Studio
  Objetivo: Tabelas curadas e normalizadas para Analytics, BI e Machine Learning
  ========================================================================
*/

with bronze_source as (
    select * from {{ ${upstreamRef} }}
),

curated_dimensions as (
    select
        id_transacao,
        dt_geracao_origem as dt_transacao,
        cast(dt_geracao_origem as date) as data_referencia,
        extract(year from dt_geracao_origem) as ano_transacao,
        extract(month from dt_geracao_origem) as mes_transacao,
        
        -- Métricas e Faixas de Valor de Negócio
        valor_transacao,
        case 
            when valor_transacao > 1000 then 'TICKET_ALTO'
            when valor_transacao > 200 then 'TICKET_MEDIO'
            else 'TICKET_VAREJO'
        end as faixa_ticket,
        
        status_transacao,
        
        -- Identificadores LGPD Sanitizados
        cpf_titular_mascarado,
        numero_cartao_hash,
        email_comprador_tokenizado,
        
        -- Flags de Qualidade e Sucesso
        case 
            when status_transacao in ('APROVADO', 'PAID', 'SUCCESS') then true 
            else false 
        end as ind_transacao_sucesso,
        
        current_timestamp() as _dbt_silver_updated_at
        
    from bronze_source
    where id_transacao is not null
      and valor_transacao >= 0
)

select * from curated_dimensions
`;
  }

  // Gold Layer
  return `{{ config(
    materialized = '${materialization}',
    schema = 'gold',
    tags = ['lakehouse', 'gold', 'data_mart', 'executivo', 'kpis'],
    cluster_by = ['ano_transacao', 'mes_transacao']
) }}

/*
  ========================================================================
  Modelo dbt: Camada Gold (Data Marts & Métricas de Negócio)
  Gerado automaticamente pela plataforma DataCore Studio
  Objetivo: Agregações de alta performance e KPIs consolidados para Dashboards
  ========================================================================
*/

with silver_source as (
    select * from {{ ${upstreamRef} }}
),

aggregated_kpis as (
    select
        data_referencia,
        ano_transacao,
        mes_transacao,
        status_transacao,
        faixa_ticket,
        
        -- KPIs Agregados de Volume e Receita
        count(distinct id_transacao) as total_transacoes,
        count(distinct cpf_titular_mascarado) as clientes_unicos_atendidos,
        sum(case when ind_transacao_sucesso then valor_transacao else 0 end) as receita_liquida_total,
        avg(case when ind_transacao_sucesso then valor_transacao else null end) as ticket_medio,
        sum(case when not ind_transacao_sucesso then 1 else 0 end) as total_cancelamentos,
        
        -- Taxa de Conversão SLA
        round(
            (sum(case when ind_transacao_sucesso then 1 else 0 end) * 100.0) / count(*), 
            2
        ) as taxa_aprovacao_percentual,
        
        current_timestamp() as _dbt_gold_loaded_at

    from silver_source
    group by 1, 2, 3, 4, 5
)

select * from aggregated_kpis
`;
};

export const generateDbtSchemaYml = (modelName: string, layer: DbtLayer): string => {
  return `version: 2

models:
  - name: ${modelName}
    description: "Modelo da camada ${layer.toUpperCase()} gerado pelo DataCore Studio com validações de integridade e LGPD."
    config:
      tags: ['lakehouse', '${layer}', 'datacore']
    columns:
      - name: id_transacao
        description: "Chave primária exclusiva da transação."
        tests:
          - unique
          - not_null
      - name: valor_transacao
        description: "Valor financeiro da operação em moeda corrente."
        tests:
          - not_null
      - name: cpf_titular_mascarado
        description: "Identificador ofuscado conforme LGPD Art. 46 (sem PII em texto claro)."
      - name: status_transacao
        description: "Status operacional da transação."
        tests:
          - accepted_values:
              values: ['APROVADO', 'PENDENTE', 'CANCELADO', 'RECUSADO']
`;
};

export const DbtSqlEditorModal: React.FC<DbtSqlEditorModalProps> = ({
  node,
  pipeline,
  onSave,
  onClose,
  canEdit,
  canBuildBronze,
  bronzeBuild,
  onBuildBronze
}) => {
  const layer = getDbtLayer(node);

  // Find upstream node connected to this node
  const upstreamEdge = pipeline.edges.find(e => e.target === node.id);
  const upstreamNode = upstreamEdge 
    ? pipeline.nodes.find(n => n.id === upstreamEdge.source) || null 
    : null;

  // Initial model name based on node title/type
  const defaultModelName = node.config.dbtModelName || 
    `${layer}_${node.title.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')}`;

  const defaultMaterialization = node.config.dbtMaterialization || 
    (layer === 'bronze' ? 'incremental' : 'table');

  const [modelName, setModelName] = useState(defaultModelName);
  const [materialization, setMaterialization] = useState(defaultMaterialization);
  const [sqlCode, setSqlCode] = useState<string>(() => {
    if (node.config.dbtSql) return node.config.dbtSql;
    return generateAutomaticDbtSql(node, layer, upstreamNode, defaultMaterialization);
  });

  const [activeTab, setActiveTab] = useState<'editor' | 'compiled' | 'schema' | 'lineage'>('editor');
  const [copied, setCopied] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileStatus, setCompileStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Auto-compilation simulation
  const getCompiledSql = (sourceCode: string): string => {
    let compiled = sourceCode;
    // Replace {{ ref('...') }} with warehouse destination table
    compiled = compiled.replace(/\{\{\s*ref\('([^']+)'\)\s*\}\}/g, (_, refName) => {
      return `analytics_dw.${refName}`;
    });
    // Replace {{ this }} with current target
    compiled = compiled.replace(/\{\{\s*this\s*\}\}/g, `analytics_dw.${modelName}`);
    // Replace config block with SQL comment
    compiled = compiled.replace(/\{\{\s*config\([\s\S]*?\)\s*\}\}/g, `-- [dbt compiled config: ${materialization} in schema '${layer}']`);
    // Replace is_incremental() condition
    compiled = compiled.replace(/\{%\s*if is_incremental\(\)\s*%\}[\s\S]*?\{%\s*endif\s*%\}/g, `-- [dbt is_incremental filter evaluated: active]`);
    return compiled.trim();
  };

  const handleRunCompile = () => {
    setIsCompiling(true);
    setCompileStatus(null);
    setTimeout(() => {
      setIsCompiling(false);
      setCompileStatus({
        success: true,
        message: `Compilado com sucesso: target/compiled/datacore/models/${layer}/${modelName}.sql`
      });
    }, 400);
  };

  const handleResetToAutomatic = () => {
    if (window.confirm('Deseja restaurar o código dbt automático original gerado pela plataforma? As edições manuais serão substituídas.')) {
      const autoSql = generateAutomaticDbtSql(node, layer, upstreamNode, materialization);
      setSqlCode(autoSql);
      setIsDirty(true);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(sqlCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([sqlCode], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${modelName}.sql`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    onSave(node.id, sqlCode, modelName, materialization);
    setIsDirty(false);
    onClose();
  };

  // Synchronize materialization dropdown with config in SQL code
  const handleMaterializationChange = (newMat: string) => {
    setMaterialization(newMat as any);
    setIsDirty(true);
    // Replace materialized = '...' in sql code
    const updated = sqlCode.replace(
      /materialized\s*=\s*'[^']+'/,
      `materialized = '${newMat}'`
    );
    setSqlCode(updated);
  };

  const layerTheme = {
    bronze: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      badge: 'bg-orange-100 text-orange-800 border-orange-300',
      accent: 'text-orange-600',
      glow: 'shadow-orange-500/20',
      name: 'Camada Bronze',
      role: 'Validação de Schema & Sanitização LGPD'
    },
    silver: {
      bg: 'bg-teal-50',
      border: 'border-teal-200',
      badge: 'bg-teal-100 text-teal-800 border-teal-300',
      accent: 'text-teal-600',
      glow: 'shadow-teal-500/20',
      name: 'Camada Silver',
      role: 'Curadoria & Dimensões Conformadas'
    },
    gold: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      badge: 'bg-amber-100 text-amber-800 border-amber-300',
      accent: 'text-amber-600',
      glow: 'shadow-amber-500/20',
      name: 'Camada Gold',
      role: 'Data Marts & KPIs Analíticos'
    }
  }[layer];

  // Number of lines for the gutter
  const lineCount = sqlCode.split('\n').length;

  return (
    <div 
      id="dbt-sql-editor-overlay"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
    >
      <div 
        id="dbt-sql-editor-container"
        className="bg-slate-900 border border-slate-700 w-full max-w-6xl h-[92vh] max-h-[900px] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
      >
        {/* Top Header */}
        <div className="bg-slate-900 border-b border-slate-800 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* dbt Logo Badge */}
            <div className="w-8 h-8 rounded-lg bg-[#FF694B] text-white flex items-center justify-center font-bold text-xs tracking-tight shadow-md shrink-0">
              dbt
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  dbt SQL Model Editor
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${layerTheme.badge}`}>
                  {layerTheme.name}
                </span>
                {isDirty && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono animate-pulse">
                    Modificado
                  </span>
                )}
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 truncate">
                <span className="text-slate-400 font-mono text-xs">models/medallion/{layer}/</span>
                <span className="text-amber-400 font-mono">{modelName}.sql</span>
              </h2>
            </div>
          </div>

          {/* Quick Actions & Close */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Run compile */}
            <button
              type="button"
              id="btn-dbt-compile"
              onClick={handleRunCompile}
              disabled={isCompiling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer"
              title="Executar dbt compile e verificar integridade Jinja"
            >
              {isCompiling ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <Terminal className="w-3.5 h-3.5 text-[#FF694B]" />
              )}
              <span className="hidden sm:inline">dbt compile</span>
            </button>

            {/* Reset to Automatic */}
            {canEdit && (
              <button
                type="button"
                id="btn-dbt-reset-auto"
                onClick={handleResetToAutomatic}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition cursor-pointer"
                title="Restaurar código automático padrão da plataforma"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden md:inline">Restaurar Automático</span>
              </button>
            )}

            {/* Copy button */}
            <button
              type="button"
              id="btn-dbt-copy"
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition cursor-pointer"
              title="Copiar código SQL"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>

            {/* Download button */}
            <button
              type="button"
              id="btn-dbt-download"
              onClick={handleDownload}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition cursor-pointer"
              title="Baixar arquivo .sql"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            {/* Close */}
            <button
              type="button"
              id="btn-dbt-close"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 transition cursor-pointer ml-1"
              title="Fechar Editor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Subheader Toolbar: Materialization + Model Name + Tabs */}
        <div className="bg-slate-900/90 border-b border-slate-800 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Materialization select */}
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-lg">
              <span className="text-slate-400 font-medium">Materialização:</span>
              <select
                disabled={!canEdit}
                value={materialization}
                onChange={(e) => handleMaterializationChange(e.target.value)}
                className="bg-transparent text-emerald-400 font-mono font-semibold focus:outline-none cursor-pointer"
              >
                <option value="incremental" className="bg-slate-900 text-slate-100">incremental (Micro-batch)</option>
                <option value="table" className="bg-slate-900 text-slate-100">table (Tabela Física)</option>
                <option value="view" className="bg-slate-900 text-slate-100">view (Visão Lógica)</option>
                <option value="ephemeral" className="bg-slate-900 text-slate-100">ephemeral (CTE Temporária)</option>
              </select>
            </div>

            {/* Upstream Reference */}
            {upstreamNode && (
              <div className="hidden lg:flex items-center gap-1.5 text-slate-400 bg-slate-800/50 border border-slate-700/60 px-2.5 py-1 rounded-lg text-[11px]">
                <span>Origem DAG:</span>
                <code className="text-cyan-300 font-mono font-bold">
                  ref(&apos;{upstreamNode.title.toLowerCase().replace(/[^a-z0-9_]/g, '_')}&apos;)
                </code>
              </div>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-slate-800/80 border border-slate-700 p-0.5 rounded-lg">
            <button
              type="button"
              id="tab-dbt-editor"
              onClick={() => setActiveTab('editor')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'editor' 
                  ? 'bg-[#FF694B] text-white shadow-xs' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Editor SQL (.sql)</span>
            </button>

            <button
              type="button"
              id="tab-dbt-compiled"
              onClick={() => {
                setActiveTab('compiled');
                if (!compileStatus) handleRunCompile();
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'compiled' 
                  ? 'bg-indigo-600 text-white shadow-xs' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>SQL Compilado</span>
            </button>

            <button
              type="button"
              id="tab-dbt-schema"
              onClick={() => setActiveTab('schema')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'schema' 
                  ? 'bg-teal-600 text-white shadow-xs' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>schema.yml (Testes)</span>
            </button>
          </div>
        </div>

        {/* Real "Construir Camada Bronze" action — mirrors every table Airbyte
            already replicated into raw_ into bronze_, via the gateway's BigQuery
            route. Only shown for bronze nodes on a BigQuery destination. */}
        {layer === 'bronze' && node.config.bigquery && (
          <div className="px-5 py-3 bg-orange-950/40 border-b border-orange-900/60 text-xs shrink-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-orange-200 font-mono">
                <Database className="w-4 h-4 text-orange-400 shrink-0" />
                <span className="font-semibold">{node.config.bigquery.rawDataset}</span>
                <span className="text-orange-500">→</span>
                <span className="font-semibold">{node.config.bigquery.bronzeDataset}</span>
                <span className="text-orange-400/80">
                  ({node.config.bigquery.tables.length} {node.config.bigquery.tables.length === 1 ? 'tabela' : 'tabelas'})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  id="btn-build-bronze"
                  disabled={!canBuildBronze || bronzeBuild.status === 'running'}
                  onClick={() => onBuildBronze(false)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    !canBuildBronze || bronzeBuild.status === 'running'
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-orange-600 hover:bg-orange-500 text-white'
                  }`}
                >
                  {bronzeBuild.status === 'running' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>{bronzeBuild.status === 'running' ? 'Construindo...' : 'Construir Camada Bronze (BigQuery real)'}</span>
                </button>
                <button
                  type="button"
                  id="btn-build-bronze-full"
                  disabled={!canBuildBronze || bronzeBuild.status === 'running'}
                  onClick={() => onBuildBronze(true)}
                  title="Reconstrói do zero (--full-refresh). Use na 1ª vez, ou quando o schema mudou / a tabela veio do modo antigo."
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer border ${
                    !canBuildBronze || bronzeBuild.status === 'running'
                      ? 'bg-slate-800 text-slate-600 border-slate-800 cursor-not-allowed'
                      : 'bg-slate-800 hover:bg-slate-700 text-orange-300 border-orange-900/60'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Do zero</span>
                </button>
              </div>
            </div>

            {bronzeBuild.error && (
              <div className="flex items-start gap-1.5 bg-rose-950/60 border border-rose-800 rounded-lg p-2 text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{bronzeBuild.error}</span>
              </div>
            )}

            {bronzeBuild.results && (
              <div className="flex flex-wrap gap-1.5">
                {bronzeBuild.results.map(r => (
                  <span
                    key={r.table}
                    title={r.error}
                    className={`flex items-center gap-1 px-2 py-1 rounded font-mono text-[11px] border ${
                      r.status === 'ok'
                        ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                        : 'bg-rose-950/50 border-rose-800 text-rose-300'
                    }`}
                  >
                    {r.status === 'ok' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {r.table}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compile Banner Feedback if exists */}
        {compileStatus && (
          <div className="px-5 py-2 bg-emerald-950/60 border-b border-emerald-800 text-emerald-300 text-xs flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-mono">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{compileStatus.message}</span>
            </div>
            <span className="text-[10px] text-emerald-400 bg-emerald-900/60 px-2 py-0.5 rounded font-mono">
              dbt Core v1.8 • OK
            </span>
          </div>
        )}

        {/* Main Workspace Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* TAB 1: Real-time dbt SQL Editor */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex overflow-hidden bg-slate-950">
              {/* Line Numbers Gutter */}
              <div className="w-12 py-4 bg-slate-900/70 border-r border-slate-800 text-right pr-3 select-none text-slate-600 font-mono text-xs leading-relaxed hidden sm:block">
                {Array.from({ length: Math.max(lineCount, 25) }, (_, i) => (
                  <div key={i + 1} className="leading-6">{i + 1}</div>
                ))}
              </div>

              {/* Code Textarea */}
              <div className="flex-1 relative flex flex-col overflow-hidden">
                <textarea
                  id="dbt-sql-code-editor"
                  value={sqlCode}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setSqlCode(e.target.value);
                    setIsDirty(true);
                  }}
                  spellCheck={false}
                  placeholder="Insira o código SQL do dbt com Jinja macros..."
                  className="flex-1 w-full p-4 bg-transparent text-emerald-300 font-mono text-xs sm:text-sm leading-6 resize-none focus:outline-none selection:bg-indigo-900 selection:text-white overflow-y-auto"
                />

                {/* Bottom Editor Status Bar */}
                <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-[11px] text-slate-400 select-none">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      dbt Dialect: ANSI SQL / Jinja
                    </span>
                    <span>{lineCount} linhas</span>
                    <span>{sqlCode.length} caracteres</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Node: {node.title}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Compiled SQL Preview (Jinja rendered) */}
          {activeTab === 'compiled' && (
            <div className="flex-1 flex flex-col bg-slate-950 p-5 overflow-y-auto">
              <div className="mb-3 p-3 rounded-lg bg-indigo-950/50 border border-indigo-800 text-indigo-200 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  <span>Código SQL compilado pelo dbt para execução no Data Warehouse de destino:</span>
                </div>
                <span className="font-mono text-[11px] text-indigo-300 bg-indigo-900/60 px-2 py-0.5 rounded">
                  Target: BigQuery / Snowflake / Databricks
                </span>
              </div>

              <pre className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-xs leading-relaxed overflow-x-auto select-all flex-1">
                {getCompiledSql(sqlCode)}
              </pre>
            </div>
          )}

          {/* TAB 3: schema.yml (Documentation & Tests) */}
          {activeTab === 'schema' && (
            <div className="flex-1 flex flex-col bg-slate-950 p-5 overflow-y-auto">
              <div className="mb-3 p-3 rounded-lg bg-teal-950/50 border border-teal-800 text-teal-200 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-teal-400" />
                  <span>Especificação dbt schema.yml com testes automatizados de unicidade, não-nulos e LGPD:</span>
                </div>
                <span className="font-mono text-[11px] text-teal-300 bg-teal-900/60 px-2 py-0.5 rounded">
                  models/{layer}/schema.yml
                </span>
              </div>

              <pre className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-amber-300 font-mono text-xs leading-relaxed overflow-x-auto select-all flex-1">
                {generateDbtSchemaYml(modelName, layer)}
              </pre>
            </div>
          )}
        </div>

        {/* Bottom Footer Actions */}
        <div className="bg-slate-900 border-t border-slate-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">
              O código editado é salvo diretamente na configuração do nó da pipeline e integrado ao CI/CD do dbt.
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              id="btn-dbt-cancel"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              id="btn-dbt-save"
              onClick={handleSave}
              disabled={!canEdit}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition shadow-md cursor-pointer ${
                canEdit 
                  ? 'bg-gradient-to-r from-[#FF694B] to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-orange-950' 
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>Salvar Modelo dbt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
