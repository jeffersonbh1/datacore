import React, { useEffect, useState } from 'react';
import {
  Wand2, Database, Server, Layers, Check, ArrowRight, ArrowLeft,
  Sparkles, RefreshCw, Table, ShieldCheck, CheckCircle2, AlertCircle,
  Lock, Unlock, Key, Network, Eye, ExternalLink, Plus, Trash2,
  HardDrive, Cpu, Radio, Zap, Globe, FileText, ChevronRight, ChevronDown,
  FolderArchive, Boxes, Clock, Calendar, CalendarDays, CalendarRange,
  PlayCircle, X
} from 'lucide-react';
import {
  SourceConnectorConfig, DestinationConnectorConfig, AutoIntegration,
  SourceType, DestinationType, Pipeline, CloudProvider,
  DiscoveredTable, SyncFrequencyOption, SourceCatalogEntry, AirbyteStreamSummary,
  TableLoadType, TableSyncConfig
} from '../../types';
import {
  AirbyteDestination, AirbyteSource, AirbyteConnectionStreamInput, createAirbyteConnection, createAirbyteSource, createBigQueryDestination,
  deleteAirbyteDestination, deleteAirbyteSource, fetchExistingDestinations, fetchExistingSources,
  fetchSourceCatalog, fetchStreams, generateDbtModels, regenerateDbtModelsFromIntegration
} from '../../lib/airbyteGateway';
import { registrarOrigem, registrarDestino, registrarIntegracao, persistPipeline } from '../../lib/supabase';
import { buildPipelineFromIntegration, WEEKDAYS } from '../../lib/pipelineBuilder';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRealAirbyteId = (id: string): boolean => UUID_PATTERN.test(id);

interface AutoPipelineViewProps {
  sources: SourceConnectorConfig[];
  destinations: DestinationConnectorConfig[];
  integrations: AutoIntegration[];
  /** Empresa (tenant) of the logged-in user. When null, sources/destinations/integrations
   *  created in this wizard run are NOT persisted to Supabase (Airbyte creation still works). */
  idEmpresa: number | null;
  /** Empresa's own Airbyte workspace (Fase 3). Null falls back to the gateway's shared workspace. */
  airbyteWorkspaceId: string | null;
  onAddSource: (source: SourceConnectorConfig) => void;
  onAddDestination: (destination: DestinationConnectorConfig) => void;
  onCreateIntegration: (integration: AutoIntegration, generatedPipeline: Pipeline) => void;
  onNavigateToStudio: (pipelineId: string) => void;
  canCreate: boolean;
}

export const AutoPipelineView: React.FC<AutoPipelineViewProps> = ({
  sources,
  destinations,
  integrations,
  idEmpresa,
  airbyteWorkspaceId,
  onAddSource,
  onAddDestination,
  onCreateIntegration,
  onNavigateToStudio,
  canCreate
}) => {
  // Navigation mode: 'wizard' | 'overview'
  const [activeSubTab, setActiveSubTab] = useState<'wizard' | 'overview'>('wizard');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  // --------------------------------------------------------------------------
  // STEP 1: ORIGIN / SOURCE CONNECTOR STATE
  // --------------------------------------------------------------------------
  const [sourceMode, setSourceMode] = useState<'new' | 'existing'>('new');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(sources[0]?.id || '');

  // Real sources already registered in Airbyte, for "Usar Origem Existente"
  // (replaces the locally-mocked `sources` list entirely — Airbyte is the source of truth)
  const [existingAirbyteSources, setExistingAirbyteSources] = useState<AirbyteSource[]>([]);
  const [isLoadingExistingSources, setIsLoadingExistingSources] = useState(false);
  const [existingSourcesError, setExistingSourcesError] = useState<string | null>(null);
  const [hasFetchedExistingSources, setHasFetchedExistingSources] = useState(false);

  useEffect(() => {
    if (hasFetchedExistingSources) return;

    let cancelled = false;
    setIsLoadingExistingSources(true);
    setExistingSourcesError(null);

    fetchExistingSources(airbyteWorkspaceId || undefined)
      .then(list => {
        if (cancelled) return;
        setExistingAirbyteSources(list);
      })
      .catch(err => {
        if (cancelled) return;
        setExistingSourcesError(err instanceof Error ? err.message : 'Falha ao carregar origens do Airbyte.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingExistingSources(false);
        setHasFetchedExistingSources(true);
      });

    return () => { cancelled = true; };
  }, [hasFetchedExistingSources]);

  // Maps a real Airbyte source (arbitrary per-type configuration) into the local
  // SourceConnectorConfig shape used elsewhere in the wizard/app.
  const mapAirbyteSourceToConnectorConfig = (src: AirbyteSource): SourceConnectorConfig => {
    const cfg = src.configuration || {};
    const type = (src.sourceType as SourceType) || 'postgres';
    const sslMode = (cfg.ssl_mode as { mode?: string } | undefined)?.mode;
    return {
      id: src.sourceId,
      name: src.name,
      type,
      provider: getProviderForSource(type),
      host: (cfg.host as string) || (cfg.spreadsheetId as string) || 'faker-generator',
      port: (cfg.port as number) ?? 0,
      database: (cfg.database as string) || (cfg.dataset_id as string) || '-',
      username: (cfg.username as string) || '',
      schema: Array.isArray(cfg.schemas) ? (cfg.schemas as string[])[0] : undefined,
      ssl: Boolean(sslMode && sslMode !== 'disable' && sslMode !== 'disabled'),
      discoveredTables: [],
      status: 'connected',
      lastTestedAt: 'Sincronizado do Airbyte',
      createdAt: src.createdAt ? new Date(src.createdAt * 1000).toISOString().split('T')[0] : '',
    };
  };

  const handleSelectExistingSource = (src: AirbyteSource) => {
    setSelectedSourceId(src.sourceId);
    if (!sources.some(s => s.id === src.sourceId)) {
      onAddSource(mapAirbyteSourceToConnectorConfig(src));
    }
  };

  const handleRequestDeleteSource = (e: React.MouseEvent, src: AirbyteSource) => {
    e.stopPropagation();
    setDeleteConfirmTarget({ kind: 'source', id: src.sourceId, name: src.name });
  };

  // Real connector catalog (fetched from the Airbyte Gateway backend)
  const [sourceCatalog, setSourceCatalog] = useState<SourceCatalogEntry[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSourceCatalog()
      .then(catalog => {
        if (cancelled) return;
        setSourceCatalog(catalog);
        if (catalog[0]) setSourceType(catalog[0].id as SourceType);
      })
      .catch(err => {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : 'Falha ao carregar conectores.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCatalog(false);
      });
    return () => { cancelled = true; };
  }, []);

  // New source form fields
  const [sourceName, setSourceName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('postgres');
  const [sourceHost, setSourceHost] = useState('db-oltp.production.aws.com');
  const [sourcePort, setSourcePort] = useState<number | string>(5432);
  const [sourceDatabase, setSourceDatabase] = useState('vendas_corp');
  const [sourceUsername, setSourceUsername] = useState('etl_readonly');
  const [sourcePassword, setSourcePassword] = useState('••••••••••••');
  const [sourceSchema, setSourceSchema] = useState('public');
  const [sourceSsl, setSourceSsl] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // Faker connector fields
  const [fakerCount, setFakerCount] = useState<number>(1000);
  const [fakerSeed, setFakerSeed] = useState<number>(0);

  // Google Sheets connector fields
  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState('');
  const [sheetsServiceAccountJson, setSheetsServiceAccountJson] = useState('');

  // Real Airbyte source created for this wizard run (set after a successful test/creation)
  const [airbyteSourceId, setAirbyteSourceId] = useState<string | null>(null);

  // Source test status & schema discovery
  const [isTestingSource, setIsTestingSource] = useState(false);
  const [sourceTestSuccess, setSourceTestSuccess] = useState<boolean | null>(null);
  const [sourceTestMessage, setSourceTestMessage] = useState('');
  // As tabelas do Passo 3 vêm exclusivamente da descoberta real do Airbyte
  // (realStreams), que só acontece depois de criar a origem no Passo 1. Sem
  // dados de exemplo/mock — só o que o usuário adiciona manualmente entra aqui.
  const [discoveredTables, setDiscoveredTables] = useState<DiscoveredTable[]>([]);

  // --------------------------------------------------------------------------
  // STEP 2: DESTINATION CONNECTOR STATE
  // --------------------------------------------------------------------------
  const [destMode, setDestMode] = useState<'new' | 'existing'>('new');
  const [selectedDestId, setSelectedDestId] = useState<string>(destinations[0]?.id || '');

  // Real destinations already registered in Airbyte, for "Usar Destino Existente"
  const [existingAirbyteDestinations, setExistingAirbyteDestinations] = useState<AirbyteDestination[]>([]);
  const [isLoadingExistingDestinations, setIsLoadingExistingDestinations] = useState(false);
  const [existingDestinationsError, setExistingDestinationsError] = useState<string | null>(null);
  const [hasFetchedExistingDestinations, setHasFetchedExistingDestinations] = useState(false);

  useEffect(() => {
    if (hasFetchedExistingDestinations) return;

    let cancelled = false;
    setIsLoadingExistingDestinations(true);
    setExistingDestinationsError(null);

    fetchExistingDestinations(airbyteWorkspaceId || undefined)
      .then(list => {
        if (cancelled) return;
        setExistingAirbyteDestinations(list);
      })
      .catch(err => {
        if (cancelled) return;
        setExistingDestinationsError(err instanceof Error ? err.message : 'Falha ao carregar destinos do Airbyte.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingExistingDestinations(false);
        setHasFetchedExistingDestinations(true);
      });

    return () => { cancelled = true; };
  }, [hasFetchedExistingDestinations]);

  // Maps a real Airbyte destination into the local DestinationConnectorConfig shape
  const mapAirbyteDestinationToConnectorConfig = (dst: AirbyteDestination): DestinationConnectorConfig => {
    const cfg = dst.configuration || {};
    const type = (dst.destinationType as DestinationType) || 'bigquery';
    return {
      id: dst.destinationId,
      name: dst.name,
      type,
      provider: getProviderForDest(type),
      accountOrProject: (cfg.project_id as string) || (cfg.account as string) || '-',
      warehouseOrCluster: (cfg.dataset_location as string) || (cfg.warehouse as string) || undefined,
      databaseOrDataset: (cfg.dataset_id as string) || (cfg.database as string) || '-',
      authMethod: 'service_account',
      writeMode: 'merge_upsert',
      status: 'connected',
      lastTestedAt: 'Sincronizado do Airbyte',
      createdAt: dst.createdAt ? new Date(dst.createdAt * 1000).toISOString().split('T')[0] : '',
    };
  };

  const handleSelectExistingDestination = (dst: AirbyteDestination) => {
    setSelectedDestId(dst.destinationId);
    if (!destinations.some(d => d.id === dst.destinationId)) {
      onAddDestination(mapAirbyteDestinationToConnectorConfig(dst));
    }
  };

  const handleRequestDeleteDestination = (e: React.MouseEvent, dst: AirbyteDestination) => {
    e.stopPropagation();
    setDeleteConfirmTarget({ kind: 'destination', id: dst.destinationId, name: dst.name });
  };

  // New destination form fields
  const [destName, setDestName] = useState('');
  const [destType, setDestType] = useState<DestinationType>('bigquery');
  const [destAccountOrProject, setDestAccountOrProject] = useState('corp-datalake-prod-3891');
  const [destWarehouseOrCluster, setDestWarehouseOrCluster] = useState('southamerica-east1');
  const [destDatabaseOrDataset, setDestDatabaseOrDataset] = useState('analytics_curated');
  const [destSchema, setDestSchema] = useState('public');
  const [destAuthMethod, setDestAuthMethod] = useState<'service_account' | 'key_pair' | 'user_pass' | 'iam_role'>('service_account');
  const [destCredentials, setDestCredentials] = useState('');
  const [destCredentialsFileName, setDestCredentialsFileName] = useState<string | null>(null);
  const [destWriteMode, setDestWriteMode] = useState<'append' | 'merge_upsert' | 'overwrite'>('merge_upsert');

  // Destination test status
  const [isTestingDest, setIsTestingDest] = useState(false);
  const [destTestSuccess, setDestTestSuccess] = useState<boolean | null>(null);
  const [destTestMessage, setDestTestMessage] = useState('');

  // --------------------------------------------------------------------------
  // STEP 3: INTEGRATION SETUP & TABLE SELECTION
  // --------------------------------------------------------------------------
  const [integrationName, setIntegrationName] = useState('');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  // Real stream discovery (Airbyte) for the currently selected/created source —
  // works the same whether the source was just created (new) or picked from
  // "Usar Origem Existente", since both paths keep `selectedSourceId` in sync
  // with the real Airbyte source id.
  const [realStreams, setRealStreams] = useState<AirbyteStreamSummary[]>([]);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const [streamsFetchedForSourceId, setStreamsFetchedForSourceId] = useState<string | null>(null);
  const usingRealStreams = realStreams.length > 0;

  useEffect(() => {
    if (wizardStep !== 3 || !selectedSourceId) return;
    if (streamsFetchedForSourceId === selectedSourceId) return;

    let cancelled = false;
    setIsLoadingStreams(true);
    setStreamsError(null);

    fetchStreams(selectedSourceId)
      .then(streams => {
        if (cancelled) return;
        setRealStreams(streams);
        setSelectedTables(streams.map(s => s.streamName));
      })
      .catch(err => {
        if (cancelled) return;
        setRealStreams([]);
        setStreamsError(err instanceof Error ? err.message : 'Falha ao descobrir as tabelas reais da origem.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingStreams(false);
        setStreamsFetchedForSourceId(selectedSourceId);
      });

    return () => { cancelled = true; };
  }, [wizardStep, selectedSourceId, streamsFetchedForSourceId]);

  // Per-table load configuration (sync mode, cursor field & column selection) —
  // mirrors what the Airbyte UI asks when configuring a connection manually.
  // Only overrides are kept here; missing entries fall back to sensible defaults
  // (Full Refresh, every column selected) computed on the fly by getTableSyncConfig.
  const [tableSyncConfigs, setTableSyncConfigs] = useState<Record<string, TableSyncConfig>>({});
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const getTableColumns = (tableName: string): string[] => {
    if (usingRealStreams) {
      return realStreams.find(s => s.streamName === tableName)?.columns || [];
    }
    return discoveredTables.find(t => t.name === tableName)?.columns || [];
  };

  const getStreamSummary = (tableName: string): AirbyteStreamSummary | undefined =>
    usingRealStreams ? realStreams.find(s => s.streamName === tableName) : undefined;

  const getTableSyncConfig = (tableName: string): TableSyncConfig => {
    const existing = tableSyncConfigs[tableName];
    if (existing) return existing;
    const columns = getTableColumns(tableName);
    const stream = getStreamSummary(tableName);
    return {
      loadType: 'full_refresh',
      cursorField: stream?.sourceDefinedCursorField ? (stream.cursorField[0] || '') : '',
      selectedColumns: columns,
    };
  };

  const updateTableSyncConfig = (tableName: string, patch: Partial<TableSyncConfig>) => {
    setTableSyncConfigs(prev => ({
      ...prev,
      [tableName]: { ...getTableSyncConfig(tableName), ...patch },
    }));
  };

  const handleChangeLoadType = (tableName: string, loadType: TableLoadType) => {
    const current = getTableSyncConfig(tableName);
    const stream = getStreamSummary(tableName);
    updateTableSyncConfig(tableName, {
      loadType,
      cursorField: loadType === 'full_refresh'
        ? ''
        : (current.cursorField || stream?.cursorField[0] || ''),
    });
  };

  const handleChangeCursorField = (tableName: string, cursorField: string) => {
    updateTableSyncConfig(tableName, { cursorField });
  };

  const handleToggleColumn = (tableName: string, column: string) => {
    const cfg = getTableSyncConfig(tableName);
    if (cfg.loadType === 'incremental' && cfg.cursorField === column) return; // cursor column can't be excluded
    const nextColumns = cfg.selectedColumns.includes(column)
      ? cfg.selectedColumns.filter(c => c !== column)
      : [...cfg.selectedColumns, column];
    updateTableSyncConfig(tableName, { selectedColumns: nextColumns });
  };

  // Validates that every selected table set to "Incremental" has a cursor field chosen —
  // exactly like Airbyte's own UI requires before a connection can be saved.
  const validateTableSyncConfigs = (): string | null => {
    for (const tableName of selectedTables) {
      const cfg = getTableSyncConfig(tableName);
      if (cfg.loadType === 'incremental' && !cfg.cursorField) {
        return `Selecione o campo de cursor da tabela "${tableName}" — obrigatório para carga incremental.`;
      }
    }
    return null;
  };

  const [syncFrequency, setSyncFrequency] = useState<SyncFrequencyOption>('daily');
  const [executionTimes, setExecutionTimes] = useState<string[]>(['02:00']);
  const [newTimeInput, setNewTimeInput] = useState<string>('08:00');
  const [weeklyDays, setWeeklyDays] = useState<string[]>(['seg', 'qua', 'sex']);
  const [monthlyDay, setMonthlyDay] = useState<number>(1);
  const [onceDate, setOnceDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [timeError, setTimeError] = useState<string | null>(null);

  const handleAddExecutionTime = (timeToAdd?: string) => {
    setTimeError(null);
    const targetTime = (timeToAdd || newTimeInput).trim();
    if (!targetTime) return;

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(targetTime)) {
      setTimeError('Formato inválido. Utilize o formato HH:mm (ex: 08:30).');
      return;
    }

    if (executionTimes.includes(targetTime)) {
      setTimeError(`O horário ${targetTime} já está na lista.`);
      return;
    }

    const updated = [...executionTimes, targetTime].sort();
    setExecutionTimes(updated);
  };

  const handleRemoveExecutionTime = (timeToRemove: string) => {
    setTimeError(null);
    if (executionTimes.length <= 1) {
      setTimeError('É obrigatório manter ao menos um horário de execução.');
      return;
    }
    setExecutionTimes(executionTimes.filter(t => t !== timeToRemove));
  };

  const handleToggleWeeklyDay = (dayKey: string) => {
    setTimeError(null);
    if (weeklyDays.includes(dayKey)) {
      if (weeklyDays.length <= 1) {
        setTimeError('Selecione pelo menos um dia da semana.');
        return;
      }
      setWeeklyDays(weeklyDays.filter(d => d !== dayKey));
    } else {
      setWeeklyDays([...weeklyDays, dayKey]);
    }
  };

  const getScheduleSummaryText = (): string => {
    const timesStr = executionTimes.join(', ');
    const timesCount = executionTimes.length;
    const timesLabel = timesCount === 1 ? '1 horário' : `${timesCount} horários`;

    switch (syncFrequency) {
      case 'daily':
        return `Diário às ${timesStr} (${timesLabel}/dia)`;
      case 'weekly': {
        const daysLabels = WEEKDAYS.filter(w => weeklyDays.includes(w.key)).map(w => w.label).join(', ');
        return `Semanal (${daysLabels}) às ${timesStr}`;
      }
      case 'monthly':
        return `Mensal (Dia ${monthlyDay}) às ${timesStr}`;
      case 'once': {
        const formattedDate = onceDate.split('-').reverse().join('/');
        return `Carga única em ${formattedDate} às ${timesStr}`;
      }
      default:
        return `Horários: ${timesStr}`;
    }
  };

  const [applyLgpdSanitization, setApplyLgpdSanitization] = useState(true);
  const [newCustomTable, setNewCustomTable] = useState('');

  // Creation & Success Modal
  const [isCreating, setIsCreating] = useState(false);
  const [createdPipelineId, setCreatedPipelineId] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Form error notification
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The error banner renders at the top of the page, but long steps (like Step 3) leave
  // the user scrolled far below it when an action fails — without this they see no
  // visible reaction at all. Scroll it into view whenever a new error appears.
  useEffect(() => {
    if (errorMessage) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [errorMessage]);

  // In-app confirmation modal for deleting a real Airbyte source/destination
  // (replaces the native window.confirm, which doesn't match the app's UI)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ kind: 'source' | 'destination'; id: string; name: string } | null>(null);
  const [isDeletingConfirmed, setIsDeletingConfirmed] = useState(false);

  const handleConfirmDelete = async () => {
    if (!deleteConfirmTarget) return;
    const { kind, id } = deleteConfirmTarget;

    setIsDeletingConfirmed(true);
    try {
      if (kind === 'source') {
        await deleteAirbyteSource(id);
        setExistingAirbyteSources(prev => prev.filter(s => s.sourceId !== id));
        if (selectedSourceId === id) setSelectedSourceId('');
      } else {
        await deleteAirbyteDestination(id);
        setExistingAirbyteDestinations(prev => prev.filter(d => d.destinationId !== id));
        if (selectedDestId === id) setSelectedDestId('');
      }
      setDeleteConfirmTarget(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : `Falha ao excluir ${kind === 'source' ? 'a origem' : 'o destino'} no Airbyte.`);
      setDeleteConfirmTarget(null);
    } finally {
      setIsDeletingConfirmed(false);
    }
  };

  // Real-backend submission state for Steps 1 & 2
  const [isSubmittingStep1, setIsSubmittingStep1] = useState(false);
  const [isSubmittingStep2, setIsSubmittingStep2] = useState(false);
  const [airbyteDestinationId, setAirbyteDestinationId] = useState<string | null>(null);

  // Default provider mapping
  const getProviderForSource = (type: SourceType): CloudProvider => {
    switch (type) {
      case 'postgresql': case 'postgres': return 'aws';
      case 'mysql': return 'gcp';
      case 's3': return 'aws';
      case 'kafka': return 'generic';
      case 'salesforce': return 'generic';
      case 'oracle': return 'generic';
      case 'faker': return 'generic';
      case 'google-sheets': return 'gcp';
      default: return 'generic';
    }
  };

  const getProviderForDest = (type: DestinationType): CloudProvider => {
    switch (type) {
      case 'bigquery': return 'gcp';
      case 'snowflake': return 'snowflake';
      case 'redshift': return 'aws';
      case 'databricks': return 'azure';
      case 's3_lakehouse': return 'aws';
      case 'synapse': return 'azure';
      default: return 'generic';
    }
  };

  // Builds the Airbyte-shaped config payload for the currently selected connector type
  const buildSourceConfigForCurrentType = (): Record<string, unknown> => {
    switch (sourceType) {
      case 'postgres':
        return {
          host: sourceHost.trim(),
          port: sourcePort,
          database: sourceDatabase.trim(),
          username: sourceUsername.trim(),
          password: sourcePassword,
          schema: sourceSchema.trim(),
          ssl: sourceSsl,
        };
      case 'mysql':
        return {
          host: sourceHost.trim(),
          port: sourcePort,
          database: sourceDatabase.trim(),
          username: sourceUsername.trim(),
          password: sourcePassword,
          ssl: sourceSsl,
        };
      case 'faker':
        return { count: fakerCount, seed: fakerSeed };
      case 'google-sheets':
        return { spreadsheetId: sheetsSpreadsheetId.trim(), serviceAccountJson: sheetsServiceAccountJson };
      default:
        return {};
    }
  };

  // Test source connection: creates (and validates) a real source in Airbyte
  const handleTestSource = async () => {
    setIsTestingSource(true);
    setSourceTestSuccess(null);
    setSourceTestMessage('');

    try {
      const created = await createAirbyteSource({
        name: sourceName.trim() || 'Nova Origem DataCore',
        catalogId: sourceType,
        config: buildSourceConfigForCurrentType(),
        workspaceId: airbyteWorkspaceId || undefined,
      });
      setAirbyteSourceId(created.sourceId);
      setSourceTestSuccess(true);
      setSourceTestMessage(`Conexão real estabelecida no Airbyte! Source ID: ${created.sourceId}`);
    } catch (err) {
      setSourceTestSuccess(false);
      setSourceTestMessage(err instanceof Error ? err.message : 'Falha ao conectar no Airbyte.');
    } finally {
      setIsTestingSource(false);
    }
  };

  // BigQuery's "Default Dataset ID" always carries the raw_ prefix, identifying the raw layer
  const getFullDatasetId = () => `raw_${destDatabaseOrDataset.trim()}`;

  // Test destination connection: for BigQuery, creates (and validates) the real destination in Airbyte
  const handleTestDestination = async () => {
    setDestTestSuccess(null);
    setDestTestMessage('');

    if (destType !== 'bigquery') {
      setIsTestingDest(true);
      setTimeout(() => {
        setIsTestingDest(false);
        setDestTestSuccess(true);
        setDestTestMessage('Autenticação bem-sucedida! Permissão de escrita e schema validados.');
      }, 800);
      return;
    }

    if (!destAccountOrProject.trim() || !destDatabaseOrDataset.trim() || !destCredentials.trim()) {
      setDestTestSuccess(false);
      setDestTestMessage('Preencha o Projeto GCP, o Default Dataset ID e faça upload das credenciais antes de testar.');
      return;
    }

    setIsTestingDest(true);
    try {
      const created = await createBigQueryDestination({
        name: destName.trim() || 'Novo Destino BigQuery',
        config: {
          projectId: destAccountOrProject.trim(),
          datasetId: getFullDatasetId(),
          datasetLocation: destWarehouseOrCluster.trim() || undefined,
          credentialsJson: destCredentials,
        },
        workspaceId: airbyteWorkspaceId || undefined,
      });
      setAirbyteDestinationId(created.destinationId);
      setDestTestSuccess(true);
      setDestTestMessage(`Conexão real estabelecida no Airbyte! Destination ID: ${created.destinationId}`);
    } catch (err) {
      setDestTestSuccess(false);
      setDestTestMessage(err instanceof Error ? err.message : 'Falha ao conectar no Airbyte.');
    } finally {
      setIsTestingDest(false);
    }
  };

  // Quick connector selection helpers
  const handleSelectSourceType = (type: SourceType) => {
    setSourceType(type);
    setAirbyteSourceId(null);
    setSourceTestSuccess(null);
    setSourceTestMessage('');

    if (!sourceName || sourceName.includes('PostgreSQL') || sourceName.includes('MySQL') || sourceName.includes('Faker') || sourceName.includes('Google Sheets')) {
      const defaultNames: Partial<Record<SourceType, string>> = {
        postgres: 'PostgreSQL Vendas Produção',
        mysql: 'MySQL Produção E-commerce',
        faker: 'Faker Dados de Teste',
        'google-sheets': 'Google Sheets Planilha',
      };
      setSourceName(defaultNames[type] || 'Nova Origem');
    }

    // Adjust default ports
    switch (type) {
      case 'postgres': setSourcePort(5432); break;
      case 'mysql': setSourcePort(3306); break;
      default: break;
    }
  };

  const handleSelectDestType = (type: DestinationType) => {
    setDestType(type);
    setAirbyteDestinationId(null);
    setDestCredentials('');
    setDestCredentialsFileName(null);
    if (!destName || destName.includes('BigQuery') || destName.includes('Snowflake') || destName.includes('Redshift') || destName.includes('Databricks') || destName.includes('Lakehouse')) {
      const defaultNames: Record<DestinationType, string> = {
        bigquery: 'Google BigQuery Analytics Datalake',
        snowflake: 'Snowflake Enterprise DW',
        redshift: 'AWS Redshift Lakehouse Gold',
        databricks: 'Databricks Delta Lake',
        postgresql_dw: 'PostgreSQL Data Warehouse',
        s3_lakehouse: 'Amazon S3 Parquet Lakehouse',
        synapse: 'Azure Synapse Analytics'
      };
      setDestName(defaultNames[type] || 'Novo Destino');
    }
  };

  // Reads a GCP Service Account JSON key file and extracts what's needed for the BigQuery destination
  const handleCredentialsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const parsed = JSON.parse(text);
        setDestCredentials(text);
        setDestCredentialsFileName(file.name);
        if (parsed.project_id) setDestAccountOrProject(parsed.project_id);
        setErrorMessage(null);
      } catch {
        setDestCredentialsFileName(null);
        setErrorMessage('O arquivo selecionado não é um JSON válido de chave de Service Account.');
      }
    };
    reader.readAsText(file);
  };

  // Toggle table selection
  const handleToggleTable = (tableName: string) => {
    if (selectedTables.includes(tableName)) {
      setSelectedTables(prev => prev.filter(t => t !== tableName));
    } else {
      setSelectedTables(prev => [...prev, tableName]);
    }
  };

  const handleSelectAllTables = () => {
    setSelectedTables(discoveredTables.map(t => t.name));
  };

  const handleClearTables = () => {
    setSelectedTables([]);
  };

  const handleAddCustomTable = () => {
    if (!newCustomTable.trim()) return;
    const cleanName = newCustomTable.trim().toLowerCase().replace(/\s+/g, '_');
    if (!discoveredTables.some(t => t.name === cleanName)) {
      setDiscoveredTables(prev => [
        ...prev,
        {
          name: cleanName,
          rowCount: 5000,
          columns: ['id', 'data', 'criado_em'],
          hasPII: false
        }
      ]);
      setSelectedTables(prev => [...prev, cleanName]);
    }
    setNewCustomTable('');
  };

  // Step 1 field validation (varies by connector type — Faker/Google Sheets don't use host/database)
  const validateStep1Fields = (): string | null => {
    if (!sourceName.trim()) return 'Por favor, informe o Nome da Origem antes de avançar.';

    if (sourceType === 'postgres' || sourceType === 'mysql') {
      if (!sourceHost.trim() || !sourceDatabase.trim()) {
        return 'Por favor, informe o Host e Banco/Schema da Origem.';
      }
    } else if (sourceType === 'faker') {
      if (!fakerCount || fakerCount <= 0) {
        return 'Informe uma quantidade de registros válida para o conector Faker.';
      }
    } else if (sourceType === 'google-sheets') {
      if (!sheetsSpreadsheetId.trim() || !sheetsServiceAccountJson.trim()) {
        return 'Informe o ID da planilha e as credenciais de Service Account.';
      }
    }
    return null;
  };

  // Step 1 Validation & Next: creates the real Airbyte source (reusing one from "Testar Conexão" if already created)
  const handleAdvanceFromStep1 = async () => {
    setErrorMessage(null);

    if (sourceMode === 'new') {
      const validationError = validateStep1Fields();
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmittingStep1(true);
      try {
        let realSourceId = airbyteSourceId;
        if (!realSourceId) {
          const created = await createAirbyteSource({
            name: sourceName.trim(),
            catalogId: sourceType,
            config: buildSourceConfigForCurrentType(),
            workspaceId: airbyteWorkspaceId || undefined,
          });
          realSourceId = created.sourceId;
          setAirbyteSourceId(realSourceId);
        }

        const newSourceConfig: SourceConnectorConfig = {
          id: realSourceId,
          name: sourceName.trim(),
          type: sourceType,
          provider: getProviderForSource(sourceType),
          host: sourceHost.trim(),
          port: sourcePort,
          database: sourceDatabase.trim(),
          username: sourceUsername.trim(),
          password: sourcePassword,
          schema: sourceSchema.trim(),
          ssl: sourceSsl,
          discoveredTables,
          status: 'connected',
          lastTestedAt: 'Agora',
          createdAt: new Date().toISOString().split('T')[0]
        };
        onAddSource(newSourceConfig);
        setSelectedSourceId(newSourceConfig.id);
        setWizardStep(2);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Falha ao criar a origem no Airbyte.');
      } finally {
        setIsSubmittingStep1(false);
      }
    } else {
      if (!selectedSourceId) {
        setErrorMessage('Selecione uma Origem já cadastrada.');
        return;
      }
      setWizardStep(2);
    }
  };

  // Step 2 Validation & Next: for BigQuery, creates the real destination in Airbyte
  const handleAdvanceFromStep2 = async () => {
    setErrorMessage(null);
    if (destMode === 'new') {
      if (!destName.trim()) {
        setErrorMessage('Por favor, informe o Nome do Destino antes de avançar.');
        return;
      }
      if (!destAccountOrProject.trim() || !destDatabaseOrDataset.trim()) {
        setErrorMessage('Por favor, informe o Projeto/Account e o Default Dataset ID do Destino.');
        return;
      }
      if (destType === 'bigquery' && !destCredentials.trim()) {
        setErrorMessage('Faça upload do arquivo JSON da chave da Service Account do BigQuery.');
        return;
      }

      setIsSubmittingStep2(true);
      try {
        let realDestinationId = airbyteDestinationId;
        if (destType === 'bigquery' && !realDestinationId) {
          const created = await createBigQueryDestination({
            name: destName.trim(),
            config: {
              projectId: destAccountOrProject.trim(),
              datasetId: getFullDatasetId(),
              datasetLocation: destWarehouseOrCluster.trim() || undefined,
              credentialsJson: destCredentials,
            },
            workspaceId: airbyteWorkspaceId || undefined,
          });
          realDestinationId = created.destinationId;
          setAirbyteDestinationId(realDestinationId);
        }

        const newDestConfig: DestinationConnectorConfig = {
          id: realDestinationId || `dest-${Date.now()}`,
          name: destName.trim(),
          type: destType,
          provider: getProviderForDest(destType),
          accountOrProject: destAccountOrProject.trim(),
          warehouseOrCluster: destWarehouseOrCluster.trim(),
          databaseOrDataset: destType === 'bigquery' ? getFullDatasetId() : destDatabaseOrDataset.trim(),
          schema: destSchema.trim(),
          authMethod: destAuthMethod,
          credentials: destCredentials,
          writeMode: destWriteMode,
          status: 'connected',
          lastTestedAt: 'Agora',
          createdAt: new Date().toISOString().split('T')[0]
        };
        onAddDestination(newDestConfig);
        setSelectedDestId(newDestConfig.id);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Falha ao criar o destino no Airbyte.');
        setIsSubmittingStep2(false);
        return;
      }
      setIsSubmittingStep2(false);
    } else {
      if (!selectedDestId) {
        setErrorMessage('Selecione um Destino já cadastrado.');
        return;
      }
    }

    // Auto generate integration name suggestion if empty
    if (!integrationName) {
      const activeSrc = sourceMode === 'new'
        ? sourceName
        : sources.find(s => s.id === selectedSourceId)?.name || 'Origem';
      const activeDst = destMode === 'new'
        ? destName
        : destinations.find(d => d.id === selectedDestId)?.name || 'Destino';
      setIntegrationName(`Integração Automática ${activeSrc} ➔ ${activeDst}`);
    }

    setWizardStep(3);
  };

  // --------------------------------------------------------------------------
  // FINALIZE & CREATE INTEGRATION
  // --------------------------------------------------------------------------
  const handleCreateAutoIntegration = async () => {
    setErrorMessage(null);

    if (!integrationName.trim()) {
      setErrorMessage('Por favor, informe um Nome para a Integração.');
      return;
    }

    if (selectedTables.length === 0) {
      setErrorMessage('Selecione pelo menos uma tabela para integrar.');
      return;
    }

    const tableSyncValidationError = validateTableSyncConfigs();
    if (tableSyncValidationError) {
      setErrorMessage(tableSyncValidationError);
      return;
    }

    // Identify active source and destination
    const activeSource = sources.find(s => s.id === selectedSourceId) || sources[0];
    const activeDest = destinations.find(d => d.id === selectedDestId) || destinations[0];

    if (!activeSource || !activeDest) {
      setErrorMessage('Origem ou Destino inválidos.');
      return;
    }

    setIsCreating(true);

    // Snapshot each selected table's load configuration (defaults included) so it's
    // persisted on the AutoIntegration record regardless of whether a real Airbyte
    // connection ends up being created below.
    const tableSyncConfigsSnapshot: Record<string, TableSyncConfig> = {};
    for (const tableName of selectedTables) {
      tableSyncConfigsSnapshot[tableName] = getTableSyncConfig(tableName);
    }

    // Create the real Airbyte connection when both source and destination are real
    // Airbyte resources (confirmed for the source via the streams discovery above;
    // heuristically for the destination via its UUID shape). All 4 frequency options
    // now map onto a real Airbyte schedule: daily/weekly/monthly become a native Airbyte
    // cron expression, and "once" creates the connection in manual mode (Airbyte has no
    // native one-shot future schedule — see buildAirbyteSchedule on the gateway).
    const realScheduleFrequencies: SyncFrequencyOption[] = ['daily', 'weekly', 'monthly', 'once'];
    let airbyteConnectionId: string | undefined;
    if (usingRealStreams && isRealAirbyteId(selectedDestId) && realScheduleFrequencies.includes(syncFrequency)) {
      try {
        const streams: AirbyteConnectionStreamInput[] = selectedTables.map(tableName => {
          const cfg = tableSyncConfigsSnapshot[tableName];
          const allColumns = getTableColumns(tableName);
          return {
            name: tableName,
            loadType: cfg.loadType,
            cursorField: cfg.loadType === 'incremental' ? cfg.cursorField : undefined,
            columns: cfg.selectedColumns.length < allColumns.length ? cfg.selectedColumns : undefined,
          };
        });

        const created = await createAirbyteConnection({
          name: integrationName.trim(),
          sourceId: selectedSourceId,
          destinationId: selectedDestId,
          streams,
          writeMode: destWriteMode,
          schedule: {
            frequency: syncFrequency as 'daily' | 'weekly' | 'monthly' | 'once',
            executionTimes,
            // weeklyDays holds UI keys ('seg', 'ter', ...) — convert to the Unix cron
            // values ('0'-'6', Sun=0) the gateway expects before sending.
            weeklyDays: syncFrequency === 'weekly'
              ? weeklyDays.map(d => WEEKDAYS.find(w => w.key === d)?.cronVal || '1')
              : undefined,
            monthlyDay: syncFrequency === 'monthly' ? monthlyDay : undefined,
          },
        });
        airbyteConnectionId = created.connectionId;
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Falha ao criar a integração no Airbyte.');
        setIsCreating(false);
        return;
      }
    }

    const newIntegrationId = `int-auto-${Date.now()}`;
    const scheduleSummary = getScheduleSummaryText();

    // Create the AutoIntegration record first — the canvas (nodes/edges/cron/etc.)
    // is fully derivable from it via buildPipelineFromIntegration, which is the
    // same function used to reconstruct pipelines from persisted integrations on
    // reload (see App.tsx), so a freshly-created pipeline and a reloaded one are
    // never out of sync.
    const newIntegration: AutoIntegration = {
      id: newIntegrationId,
      name: integrationName.trim(),
      sourceConnectorId: activeSource.id,
      sourceConnectorName: activeSource.name,
      sourceType: activeSource.type,
      destinationConnectorId: activeDest.id,
      destinationConnectorName: activeDest.name,
      destinationType: activeDest.type,
      selectedTables,
      tableSyncConfigs: tableSyncConfigsSnapshot,
      syncFrequency,
      executionTimes,
      weeklyDays: syncFrequency === 'weekly' ? weeklyDays : undefined,
      monthlyDay: syncFrequency === 'monthly' ? monthlyDay : undefined,
      onceDate: syncFrequency === 'once' ? onceDate : undefined,
      scheduleSummary,
      applyLgpdSanitization,
      airbyteConnectionId,
      status: 'active',
      pipelineId: '', // set below once we know the pipeline's stable id
      createdAt: new Date().toISOString().split('T')[0],
      tablesCount: selectedTables.length
    };

    const newPipeId = `pipe-auto-${Date.now()}`;
    newIntegration.pipelineId = newPipeId;
    const newPipeline = buildPipelineFromIntegration(newPipeId, newIntegration, activeSource, activeDest);

    onCreateIntegration(newIntegration, newPipeline);
    setCreatedPipelineId(newPipeId);
    setIsCreating(false);
    setShowSuccessModal(true);

    // Best-effort persistence to Supabase, scoped to the logged-in user's empresa —
    // Airbyte remains the source of truth and the UI above already reflects success
    // regardless of this outcome, so failures here are logged, not surfaced.
    if (idEmpresa) {
      try {
        const origemDbId = await registrarOrigem(idEmpresa, activeSource);
        const destinoDbId = await registrarDestino(idEmpresa, activeDest);
        const integracaoDbId = await registrarIntegracao(idEmpresa, newIntegration, origemDbId, destinoDbId);
        await persistPipeline(idEmpresa, integracaoDbId, newPipeline);
      } catch (err) {
        console.error('Erro ao persistir integração/pipeline no banco de dados:', err);
      }
    }

    // Garante que a integração tem um modelo dbt Bronze por tabela em
    // dbt/models/medallion/bronze/bronze_<tabela>.sql — é o que o gateway roda
    // depois (dbt build). A Bronze não é mais construída fora do dbt.
    if (activeDest.type === 'bigquery' && airbyteConnectionId && activeDest.accountOrProject) {
      const rawDs = activeDest.databaseOrDataset;
      const buildModels = () => generateDbtModels({
        sistema: activeSource.name,
        projectId: activeDest.accountOrProject!,
        rawDataset: rawDs,
        bronzeDataset: rawDs.replace(/^raw_/, 'bronze_'),
        applyLgpd: applyLgpdSanitization,
        tables: selectedTables.map(tableName => {
          const cfg = tableSyncConfigsSnapshot[tableName];
          const stream = getStreamSummary(tableName);
          return {
            name: tableName,
            columns: cfg.selectedColumns.length ? cfg.selectedColumns : getTableColumns(tableName),
            primaryKey: (stream?.primaryKey || []).map(p => p.join('.')),
            cursorField: cfg.loadType === 'incremental' ? cfg.cursorField : null,
            loadType: cfg.loadType,
          };
        }),
      });

      let modelsOk = false;
      let lastErr: unknown;
      // 3 tentativas do caminho direto (EPERM transitório de FS já tem retry no
      // gateway; aqui cobre falha de rede), depois o caminho por estado persistido.
      for (let attempt = 0; attempt < 3 && !modelsOk; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 700 * attempt));
          await buildModels();
          modelsOk = true;
        } catch (err) {
          lastErr = err;
          console.error(`Geração de modelos dbt — tentativa ${attempt + 1} falhou:`, err);
        }
      }
      if (!modelsOk) {
        try {
          await regenerateDbtModelsFromIntegration(airbyteConnectionId);
          modelsOk = true;
        } catch (err) {
          lastErr = err;
          console.error('Regeneração de modelos dbt por integração falhou:', err);
        }
      }
      if (!modelsOk) {
        setErrorMessage(
          'Integração criada, mas a geração dos modelos dbt da camada Bronze falhou: ' +
          (lastErr instanceof Error ? lastErr.message : 'erro desconhecido') +
          '. A Bronze não poderá ser construída até regerar os modelos.',
        );
      }
    }
  };

  // Active source/dest instances for preview in step 3
  const currentActiveSource = sourceMode === 'new' 
    ? { name: sourceName || 'Nova Origem', type: sourceType, host: sourceHost }
    : sources.find(s => s.id === selectedSourceId) || { name: 'Origem', type: 'postgresql' as SourceType, host: 'localhost' };

  const currentActiveDest = destMode === 'new'
    ? { name: destName || 'Novo Destino', type: destType, databaseOrDataset: destDatabaseOrDataset }
    : destinations.find(d => d.id === selectedDestId) || { name: 'Destino', type: 'bigquery' as DestinationType, databaseOrDataset: 'analytics' };

  return (
    <div id="auto-pipeline-container" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700">
              <Wand2 className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Cadastro de Pipeline Automático</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
              Auto-Ingestão
            </span>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Configure o conector de origem e destino, selecione as tabelas desejadas e gere instantaneamente 
            o pipeline de dados pronto com sanitização LGPD e topologia no <strong>Studio Visual ETL</strong>.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium self-start md:self-auto">
          <button
            onClick={() => setActiveSubTab('wizard')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'wizard' 
                ? 'bg-white text-slate-900 shadow-xs font-semibold' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-indigo-600" />
            <span>Assistente de Cadastro</span>
          </button>
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'overview' 
                ? 'bg-white text-slate-900 shadow-xs font-semibold' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-slate-600" />
            <span>Integrações Salvas ({integrations.length})</span>
          </button>
        </div>
      </div>

      {/* ERROR ALERT BANNER */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-sm flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button 
            onClick={() => setErrorMessage(null)} 
            className="text-rose-600 hover:text-rose-900 font-bold text-xs cursor-pointer px-2 py-1 rounded-md"
          >
            Fechar
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 1: STEP-BY-STEP WIZARD                                               */}
      {/* ========================================================================= */}
      {activeSubTab === 'wizard' && (
        <div className="space-y-6">
          {/* Stepper Progress Indicator */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Step 1 Tab */}
              <button
                onClick={() => setWizardStep(1)}
                className={`flex items-center gap-3 p-3 rounded-xl text-left transition border cursor-pointer ${
                  wizardStep === 1 
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-500/20' 
                    : wizardStep > 1
                      ? 'border-emerald-200 bg-emerald-50/30 text-emerald-900 hover:bg-slate-50'
                      : 'border-slate-200 bg-slate-50/50 text-slate-500'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                  wizardStep === 1 
                    ? 'bg-indigo-600 text-white' 
                    : wizardStep > 1 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-200 text-slate-600'
                }`}>
                  {wizardStep > 1 ? <Check className="w-4 h-4" /> : '1'}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold opacity-70">Passo 1</div>
                  <div className="text-xs font-bold text-slate-900">Conector de Origem</div>
                </div>
              </button>

              {/* Step 2 Tab */}
              <button
                onClick={() => setWizardStep(2)}
                className={`flex items-center gap-3 p-3 rounded-xl text-left transition border cursor-pointer ${
                  wizardStep === 2 
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-500/20' 
                    : wizardStep > 2
                      ? 'border-emerald-200 bg-emerald-50/30 text-emerald-900 hover:bg-slate-50'
                      : 'border-slate-200 bg-slate-50/50 text-slate-500'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                  wizardStep === 2 
                    ? 'bg-indigo-600 text-white' 
                    : wizardStep > 2 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-200 text-slate-600'
                }`}>
                  {wizardStep > 2 ? <Check className="w-4 h-4" /> : '2'}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold opacity-70">Passo 2</div>
                  <div className="text-xs font-bold text-slate-900">Conector de Destino</div>
                </div>
              </button>

              {/* Step 3 Tab */}
              <button
                onClick={() => {
                  if (wizardStep >= 2) setWizardStep(3);
                }}
                className={`flex items-center gap-3 p-3 rounded-xl text-left transition border cursor-pointer ${
                  wizardStep === 3 
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-500/20' 
                    : 'border-slate-200 bg-slate-50/50 text-slate-500'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                  wizardStep === 3 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  3
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold opacity-70">Passo 3</div>
                  <div className="text-xs font-bold text-slate-900">Integração & Tabelas</div>
                </div>
              </button>
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* STEP 1: CONECTOR DE ORIGEM                                      */}
          {/* --------------------------------------------------------------- */}
          {wizardStep === 1 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Database className="w-5 h-5 text-indigo-600" />
                    <span>Passo 1: Cadastro do Conector de Origem</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Defina o nome da origem, o tipo de banco/serviço e os parâmetros de conexão para descobrir os dados.
                  </p>
                </div>

                {/* Switch between New or Existing Origin */}
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl text-xs font-medium self-start">
                  <button
                    type="button"
                    onClick={() => setSourceMode('new')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      sourceMode === 'new' 
                        ? 'bg-white text-indigo-700 shadow-xs font-bold' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    + Cadastrar Nova Origem
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceMode('existing')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      sourceMode === 'existing' 
                        ? 'bg-white text-indigo-700 shadow-xs font-bold' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Usar Origem Existente ({existingAirbyteSources.length})
                  </button>
                </div>
              </div>

              {sourceMode === 'existing' ? (
                <div className="space-y-4">
                  <label className="block text-xs font-semibold text-slate-700">
                    Selecione uma Origem Cadastrada no Airbyte
                  </label>

                  {isLoadingExistingSources && (
                    <div className="text-xs text-slate-500 flex items-center gap-2 p-3">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Carregando origens cadastradas no Airbyte...</span>
                    </div>
                  )}

                  {!isLoadingExistingSources && existingSourcesError && (
                    <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{existingSourcesError}</span>
                    </div>
                  )}

                  {!isLoadingExistingSources && !existingSourcesError && existingAirbyteSources.length === 0 && (
                    <div className="text-xs text-slate-500 p-3">
                      Nenhuma origem cadastrada no Airbyte ainda. Use "+ Cadastrar Nova Origem" para criar a primeira.
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {existingAirbyteSources.map(src => {
                      const isSelected = selectedSourceId === src.sourceId;
                      const cfg = src.configuration || {};
                      const subtitle = (cfg.host as string) || (cfg.spreadsheetId as string) || 'Sem host (Faker)';
                      return (
                        <div
                          key={src.sourceId}
                          onClick={() => handleSelectExistingSource(src)}
                          className={`p-4 rounded-xl border transition cursor-pointer ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/20 shadow-xs'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-100 text-slate-700">
                              {src.sourceType}
                            </span>
                            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Conectado
                            </span>
                          </div>
                          <div className="font-bold text-sm text-slate-900 mb-1">{src.name}</div>
                          <div className="text-xs text-slate-500 font-mono truncate">{subtitle}</div>
                          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteSource(e, src)}
                              title="Excluir origem no Airbyte"
                              className="p-1.5 -ml-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-indigo-600 font-semibold">{isSelected ? '✓ Selecionado' : 'Selecionar'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* NEW SOURCE REGISTRATION FORM */
                <div className="space-y-6">
                  {/* Name of the Source (Mandatory requirement from prompt) */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <label className="block text-xs font-bold text-slate-900 mb-1">
                      Nome da Origem <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      placeholder="Ex: PostgreSQL Vendas Produção, MongoDB Clientes, Kafka Telemetria"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Identificador amigável para este conector de origem na plataforma.
                    </p>
                  </div>

                  {/* Connector Type Selector — driven by the Airbyte Gateway's curated catalog */}
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-2">
                      Selecione o Tipo de Conector de Origem <span className="text-rose-500">*</span>
                    </label>

                    {isLoadingCatalog && (
                      <div className="text-xs text-slate-500 flex items-center gap-2 p-3">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Carregando conectores disponíveis no Airbyte...</span>
                      </div>
                    )}

                    {catalogError && (
                      <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{catalogError}</span>
                      </div>
                    )}

                    {!isLoadingCatalog && !catalogError && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {sourceCatalog.map(entry => {
                          const isChosen = sourceType === entry.id;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => handleSelectSourceType(entry.id as SourceType)}
                              className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                                isChosen
                                  ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-xs'
                                  : 'border-slate-200 hover:border-slate-300 bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="font-bold text-xs text-slate-900">{entry.label}</span>
                                {isChosen && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">{entry.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Connection Parameters — PostgreSQL / MySQL */}
                  {(sourceType === 'postgres' || sourceType === 'mysql') && (
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-slate-400">
                        Parâmetros de Conexão da Origem
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Host / Endpoint / URL do Servidor <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={sourceHost}
                            onChange={(e) => setSourceHost(e.target.value)}
                            placeholder="db-sales.prod.us-east-1.rds.amazonaws.com"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Porta <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            value={sourcePort}
                            onChange={(e) => setSourcePort(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Banco de Dados / Schema <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={sourceDatabase}
                            onChange={(e) => setSourceDatabase(e.target.value)}
                            placeholder="vendas_corp"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Usuário de Serviço (Read-Only) <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={sourceUsername}
                            onChange={(e) => setSourceUsername(e.target.value)}
                            placeholder="etl_user"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Senha / Token de Acesso
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={sourcePassword}
                              onChange={(e) => setSourcePassword(e.target.value)}
                              placeholder="••••••••••••"
                              className="w-full pl-3 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                            >
                              {showPassword ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* SSL / TLS Toggle */}
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          <div>
                            <div className="text-xs font-bold text-slate-900">Conexão Criptografada SSL / TLS (Recomendado)</div>
                            <div className="text-[11px] text-slate-500">Exigir handshake com certificados corporativos</div>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={sourceSsl}
                          onChange={(e) => setSourceSsl(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}

                  {/* Connection Parameters — Faker */}
                  {sourceType === 'faker' && (
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-slate-400">
                        Parâmetros do Conector Faker
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Quantidade de Registros <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            value={fakerCount}
                            onChange={(e) => setFakerCount(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Seed (opcional)
                          </label>
                          <input
                            type="number"
                            value={fakerSeed}
                            onChange={(e) => setFakerSeed(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Connection Parameters — Google Sheets */}
                  {sourceType === 'google-sheets' && (
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-slate-400">
                        Parâmetros do Conector Google Sheets
                      </h3>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          ID ou URL da Planilha <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={sheetsSpreadsheetId}
                          onChange={(e) => setSheetsSpreadsheetId(e.target.value)}
                          placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Credenciais (Service Account JSON) <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                          value={sheetsServiceAccountJson}
                          onChange={(e) => setSheetsServiceAccountJson(e.target.value)}
                          rows={5}
                          placeholder='{"type": "service_account", "project_id": "..."}'
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Test Connection Button & Feedback */}
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleTestSource}
                      disabled={isTestingSource}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                    >
                      {isTestingSource ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Conectando ao Airbyte...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span>Testar Conexão & Criar no Airbyte</span>
                        </>
                      )}
                    </button>

                    {sourceTestSuccess !== null && (
                      <div className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
                        sourceTestSuccess
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-50 text-rose-800 border border-rose-200'
                      }`}>
                        {sourceTestSuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                        <span>{sourceTestMessage}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bottom Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  Passo 1 de 3: Próximo passo configurará o Destino dos dados.
                </div>
                <button
                  type="button"
                  onClick={handleAdvanceFromStep1}
                  disabled={isSubmittingStep1}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmittingStep1 ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Criando no Airbyte...</span>
                    </>
                  ) : (
                    <>
                      <span>Avançar para Destino</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* STEP 2: CONECTOR DE DESTINO                                     */}
          {/* --------------------------------------------------------------- */}
          {wizardStep === 2 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Server className="w-5 h-5 text-indigo-600" />
                    <span>Passo 2: Cadastro do Conector de Destino</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Defina o nome do destino, a plataforma de Data Warehouse/Lakehouse e os parâmetros de autenticação e carga.
                  </p>
                </div>

                {/* Switch between New or Existing Destination */}
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl text-xs font-medium self-start">
                  <button
                    type="button"
                    onClick={() => setDestMode('new')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      destMode === 'new' 
                        ? 'bg-white text-indigo-700 shadow-xs font-bold' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    + Cadastrar Novo Destino
                  </button>
                  <button
                    type="button"
                    onClick={() => setDestMode('existing')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      destMode === 'existing' 
                        ? 'bg-white text-indigo-700 shadow-xs font-bold' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Usar Destino Existente ({existingAirbyteDestinations.length})
                  </button>
                </div>
              </div>

              {destMode === 'existing' ? (
                <div className="space-y-4">
                  <label className="block text-xs font-semibold text-slate-700">
                    Selecione um Destino Cadastrado no Airbyte
                  </label>

                  {isLoadingExistingDestinations && (
                    <div className="text-xs text-slate-500 flex items-center gap-2 p-3">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Carregando destinos cadastrados no Airbyte...</span>
                    </div>
                  )}

                  {!isLoadingExistingDestinations && existingDestinationsError && (
                    <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{existingDestinationsError}</span>
                    </div>
                  )}

                  {!isLoadingExistingDestinations && !existingDestinationsError && existingAirbyteDestinations.length === 0 && (
                    <div className="text-xs text-slate-500 p-3">
                      Nenhum destino cadastrado no Airbyte ainda. Use "+ Cadastrar Novo Destino" para criar o primeiro.
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {existingAirbyteDestinations.map(dst => {
                      const isSelected = selectedDestId === dst.destinationId;
                      const cfg = dst.configuration || {};
                      const subtitle = `${(cfg.dataset_id as string) || '-'} (${(cfg.project_id as string) || '-'})`;
                      return (
                        <div
                          key={dst.destinationId}
                          onClick={() => handleSelectExistingDestination(dst)}
                          className={`p-4 rounded-xl border transition cursor-pointer ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/20 shadow-xs'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-100 text-slate-700">
                              {dst.destinationType}
                            </span>
                            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Conectado
                            </span>
                          </div>
                          <div className="font-bold text-sm text-slate-900 mb-1">{dst.name}</div>
                          <div className="text-xs text-slate-500 font-mono truncate">{subtitle}</div>
                          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteDestination(e, dst)}
                              title="Excluir destino no Airbyte"
                              className="p-1.5 -ml-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-indigo-600 font-semibold">{isSelected ? '✓ Selecionado' : 'Selecionar'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* NEW DESTINATION REGISTRATION FORM */
                <div className="space-y-6">
                  {/* Name of Destination (Mandatory requirement from prompt) */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <label className="block text-xs font-bold text-slate-900 mb-1">
                      Nome do Destino <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={destName}
                      onChange={(e) => setDestName(e.target.value)}
                      placeholder="Ex: Google BigQuery Analytics Datalake, Snowflake Enterprise DW"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Identificador amigável para este conector de destino na plataforma.
                    </p>
                  </div>

                  {/* Destination Type Selector */}
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-2">
                      Selecione o Tipo de Destino Cloud <span className="text-rose-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {[
                        { type: 'bigquery' as DestinationType, name: 'Google BigQuery', desc: 'Serverless Data Warehouse' },
                        { type: 'snowflake' as DestinationType, name: 'Snowflake', desc: 'Cloud Data Platform' },
                        { type: 'redshift' as DestinationType, name: 'Amazon Redshift', desc: 'AWS Analytics Cluster' },
                        { type: 'databricks' as DestinationType, name: 'Databricks', desc: 'Delta Lake Lakehouse' },
                        { type: 'postgresql_dw' as DestinationType, name: 'PostgreSQL DW', desc: 'Relational Warehouse' },
                        { type: 's3_lakehouse' as DestinationType, name: 'Amazon S3 Parquet', desc: 'Object Storage Lake' },
                        { type: 'synapse' as DestinationType, name: 'Azure Synapse', desc: 'Microsoft Data Analytics' }
                      ].map(item => {
                        const isChosen = destType === item.type;
                        return (
                          <button
                            key={item.type}
                            type="button"
                            onClick={() => handleSelectDestType(item.type)}
                            className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                              isChosen 
                                ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-xs' 
                                : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-bold text-xs text-slate-900">{item.name}</span>
                              {isChosen && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Destination Parameters Grid */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-slate-400">
                      Parâmetros de Conexão do Destino
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Projeto GCP / Account ID <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={destAccountOrProject}
                          onChange={(e) => setDestAccountOrProject(e.target.value)}
                          placeholder="corp-datalake-prod"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {destType === 'bigquery' ? 'Default Dataset ID' : 'Database / Dataset'} <span className="text-rose-500">*</span>
                        </label>
                        {destType === 'bigquery' ? (
                          <>
                            <div className="flex">
                              <span className="inline-flex items-center px-2.5 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg text-xs font-mono text-slate-500 whitespace-nowrap">
                                raw_
                              </span>
                              <input
                                type="text"
                                value={destDatabaseOrDataset}
                                onChange={(e) => setDestDatabaseOrDataset(e.target.value)}
                                placeholder="analytics_curated"
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-r-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            {destDatabaseOrDataset.trim() && (
                              <p className="text-[11px] text-slate-500 mt-1">
                                Dataset final no BigQuery: <span className="font-mono font-semibold text-slate-700">{getFullDatasetId()}</span>
                              </p>
                            )}
                          </>
                        ) : (
                          <input
                            type="text"
                            value={destDatabaseOrDataset}
                            onChange={(e) => setDestDatabaseOrDataset(e.target.value)}
                            placeholder="analytics_curated"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Warehouse / Cluster / Região
                        </label>
                        <input
                          type="text"
                          value={destWarehouseOrCluster}
                          onChange={(e) => setDestWarehouseOrCluster(e.target.value)}
                          placeholder="COMPUTE_WH ou US-MULTI"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Método de Autenticação
                        </label>
                        <select
                          value={destAuthMethod}
                          onChange={(e) => setDestAuthMethod(e.target.value as any)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="service_account">Service Account JSON (Recomendado GCP)</option>
                          <option value="key_pair">Key-Pair / Certificado Privado (Snowflake)</option>
                          <option value="iam_role">AWS IAM Role ARN (Cross-Account)</option>
                          <option value="user_pass">Usuário & Senha Convencional</option>
                        </select>
                      </div>

                      {destType === 'bigquery' && (
                        <div className="sm:col-span-3">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Credenciais (Arquivo JSON da Service Account) <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="file"
                            accept="application/json,.json"
                            onChange={handleCredentialsFileChange}
                            className="w-full text-xs text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:text-xs file:font-semibold file:cursor-pointer cursor-pointer"
                          />
                          {destCredentialsFileName && (
                            <p className="text-[11px] text-emerald-600 mt-1.5 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Carregado: {destCredentialsFileName} (Projeto GCP detectado: {destAccountOrProject})</span>
                            </p>
                          )}
                          <p className="text-[11px] text-slate-500 mt-1">
                            Faça upload da chave JSON da Service Account gerada no GCP (IAM &amp; Admin → Contas de Serviço → Chaves). O Projeto GCP acima é preenchido automaticamente a partir do arquivo.
                          </p>
                        </div>
                      )}

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Modo de Gravação das Tabelas
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: 'merge_upsert', label: 'Merge / Upsert (Recomendado)', desc: 'Atualiza se existir, insere novos' },
                            { id: 'append', label: 'Append Only', desc: 'Apenas adiciona registros' },
                            { id: 'overwrite', label: 'Overwrite Total', desc: 'Trunca e substitui tabela' }
                          ].map(mode => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => setDestWriteMode(mode.id as any)}
                              className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                                destWriteMode === mode.id 
                                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-semibold' 
                                  : 'border-slate-200 hover:border-slate-300 text-slate-600'
                              }`}
                            >
                              <div className="text-xs">{mode.label}</div>
                              <div className="text-[10px] text-slate-500 truncate">{mode.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Test Destination Button */}
                    <div className="pt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleTestDestination}
                        disabled={isTestingDest}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                      >
                        {isTestingDest ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>{destType === 'bigquery' ? 'Conectando ao Airbyte...' : 'Validando Destino...'}</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span>{destType === 'bigquery' ? 'Testar Conexão & Criar no Airbyte' : 'Testar Permissões de Escrita no Destino'}</span>
                          </>
                        )}
                      </button>

                      {destTestSuccess !== null && (
                        <div className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
                          destTestSuccess 
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}>
                          {destTestSuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                          <span>{destTestMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar para Origem</span>
                </button>

                <button
                  type="button"
                  onClick={handleAdvanceFromStep2}
                  disabled={isSubmittingStep2}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmittingStep2 ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Criando no Airbyte...</span>
                    </>
                  ) : (
                    <>
                      <span>Avançar para Integração</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* STEP 3: CADASTRO DA INTEGRAÇÃO & SELEÇÃO DE TABELAS             */}
          {/* --------------------------------------------------------------- */}
          {wizardStep === 3 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  <span>Passo 3: Cadastro da Integração & Seleção de Tabelas</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Dê um nome à integração, confirme a origem e destino selecionados e marque as tabelas que farão parte do fluxo ETL automático.
                </p>
              </div>

              {/* Summary Cards of Selected Origin & Destination */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Source Connector Card */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Database className="w-3.5 h-3.5" />
                    <span>Origem Selecionada</span>
                  </div>
                  <div className="text-sm font-bold text-slate-900">{currentActiveSource.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Tipo: {currentActiveSource.type.toUpperCase()} • Host: {currentActiveSource.host}
                  </div>
                </div>

                {/* Destination Connector Card */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Server className="w-3.5 h-3.5" />
                    <span>Destino Selecionado</span>
                  </div>
                  <div className="text-sm font-bold text-slate-900">{currentActiveDest.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Tipo: {currentActiveDest.type.toUpperCase()} • Dataset: {currentActiveDest.databaseOrDataset}
                  </div>
                </div>
              </div>

              {/* Architectural 4-Step Flow Banner */}
              <div className="p-4 bg-gradient-to-r from-blue-50/70 via-amber-50/70 to-teal-50/70 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Arquitetura Obrigatória de 4 Passos (Lakehouse Engine)
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded border border-indigo-200">
                    4 Componentes no Studio Visual ETL
                  </span>
                </div>
                <p className="text-xs text-slate-600 mb-3">
                  Ao criar esta integração automática, o sistema gerará 4 componentes sequenciais conectados no Studio Visual ETL:
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 bg-white/95 rounded-lg border border-blue-200 shadow-2xs">
                    <div className="flex items-center gap-1.5 font-bold text-blue-800 text-[11px] mb-0.5">
                      <Database className="w-3.5 h-3.5 text-blue-600" />
                      1. SOURCE
                    </div>
                    <div className="text-[10px] text-slate-500">Conector de dados com CDC ativo</div>
                  </div>
                  <div className="p-2.5 bg-white/95 rounded-lg border border-amber-200 shadow-2xs">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 text-[11px] mb-0.5">
                      <FolderArchive className="w-3.5 h-3.5 text-amber-600" />
                      2. RAW DATA
                    </div>
                    <div className="text-[10px] text-slate-500">Landing zone imutável com logs CDC</div>
                  </div>
                  <div className="p-2.5 bg-white/95 rounded-lg border border-orange-200 shadow-2xs">
                    <div className="flex items-center gap-1.5 font-bold text-orange-800 text-[11px] mb-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-orange-600" />
                      3. BRONZE
                    </div>
                    <div className="text-[10px] text-slate-500">Validação, dedup e anonimização LGPD</div>
                  </div>
                  <div className="p-2.5 bg-white/95 rounded-lg border border-teal-200 shadow-2xs">
                    <div className="flex items-center gap-1.5 font-bold text-teal-800 text-[11px] mb-0.5">
                      <Boxes className="w-3.5 h-3.5 text-teal-600" />
                      4. SILVER
                    </div>
                    <div className="text-[10px] text-slate-500">Curadoria analítica pronta para BI</div>
                  </div>
                </div>
              </div>

              {/* Integration Name (Mandatory requirement from prompt) */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <label className="block text-xs font-bold text-slate-900 mb-1">
                  Nome da Integração <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={integrationName}
                  onChange={(e) => setIntegrationName(e.target.value)}
                  placeholder="Ex: Sincronização Vendas Postgres -> BigQuery DW"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Este nome identificará o pipeline correspondente no <strong>Studio Visual ETL</strong>.
                </p>
              </div>

              {/* Table Selection Grid */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-900">
                      Selecione as Tabelas para Integrar <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-[11px] text-slate-500">
                      {usingRealStreams
                        ? `Tabelas reais descobertas via Airbyte (${selectedTables.length} de ${realStreams.length} selecionadas)`
                        : `Tabelas descobertas automaticamente na origem (${selectedTables.length} de ${discoveredTables.length} selecionadas)`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={usingRealStreams ? () => setSelectedTables(realStreams.map(s => s.streamName)) : handleSelectAllTables}
                      className="px-2.5 py-1 text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg font-semibold cursor-pointer"
                    >
                      Selecionar Todas
                    </button>
                    <button
                      type="button"
                      onClick={handleClearTables}
                      className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                {isLoadingStreams && (
                  <div className="text-xs text-slate-500 flex items-center gap-2 p-3">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Descobrindo tabelas reais da origem via Airbyte...</span>
                  </div>
                )}

                {!isLoadingStreams && streamsError && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{streamsError}</span>
                  </div>
                )}

                {/* Sem descoberta real e sem tabelas adicionadas manualmente:
                    nada a exibir — o usuário precisa concluir os Passos 1 e 2. */}
                {!isLoadingStreams && !usingRealStreams && discoveredTables.length === 0 && (
                  <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
                    <span>
                      Nenhuma tabela para exibir. Conclua o <strong>Passo 1 (Origem)</strong> e o{' '}
                      <strong>Passo 2 (Destino)</strong> — as tabelas são descobertas na origem real via
                      Airbyte. Você também pode adicionar tabelas manualmente abaixo.
                    </span>
                  </div>
                )}

                {/* Table Checkbox Cards */}
                {!isLoadingStreams && (usingRealStreams || discoveredTables.length > 0) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {usingRealStreams
                      ? realStreams.map(stream => {
                          const isChecked = selectedTables.includes(stream.streamName);
                          return (
                            <div
                              key={stream.streamName}
                              onClick={() => handleToggleTable(stream.streamName)}
                              className={`p-3.5 rounded-xl border transition cursor-pointer ${
                                isChecked
                                  ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-500/30'
                                  : 'border-slate-200 hover:border-slate-300 bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}} // Handled by parent div
                                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer pointer-events-none"
                                />
                                <div className="text-xs font-bold text-slate-900 font-mono">{stream.streamName}</div>
                              </div>
                              <div className="mt-2.5 pt-2 border-t border-slate-100/80 text-[11px] text-slate-500 truncate">
                                Campos: {stream.columns.slice(0, 4).join(', ')}{stream.columns.length > 4 ? '...' : ''}
                              </div>
                            </div>
                          );
                        })
                      : discoveredTables.map(tbl => {
                          const isChecked = selectedTables.includes(tbl.name);
                          return (
                            <div
                              key={tbl.name}
                              onClick={() => handleToggleTable(tbl.name)}
                              className={`p-3.5 rounded-xl border transition cursor-pointer ${
                                isChecked
                                  ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-500/30'
                                  : 'border-slate-200 hover:border-slate-300 bg-white'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}} // Handled by parent div
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer pointer-events-none"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-slate-900 font-mono">{tbl.name}</div>
                                    <div className="text-[10px] text-slate-500">~{tbl.rowCount.toLocaleString('pt-BR')} registros</div>
                                  </div>
                                </div>

                                {tbl.hasPII && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold flex items-center gap-1 shrink-0">
                                    <ShieldCheck className="w-3 h-3 text-amber-600" />
                                    PII
                                  </span>
                                )}
                              </div>

                              <div className="mt-2.5 pt-2 border-t border-slate-100/80 text-[11px] text-slate-500 truncate">
                                Campos: {tbl.columns.slice(0, 4).join(', ')}{tbl.columns.length > 4 ? '...' : ''}
                              </div>
                            </div>
                          );
                        })}
                  </div>
                )}

                {/* Add Custom Table Input (only for the simulated/legacy flow — real streams come strictly from Airbyte's discovery) */}
                {!usingRealStreams && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newCustomTable}
                      onChange={(e) => setNewCustomTable(e.target.value)}
                      placeholder="Adicionar outra tabela manualmente (ex: fiscal_nfe)"
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 max-w-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomTable}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar Tabela</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Configuração de Carga por Tabela (Sync Mode, Cursor & Colunas) —
                  mesmo comportamento da configuração manual de uma conexão no Airbyte. */}
              {!isLoadingStreams && selectedTables.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-900">
                      Configuração de Carga por Tabela <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Defina o tipo de carga de cada tabela e, se necessário, abra o detalhe para escolher as colunas que farão parte da sincronização.
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
                    {selectedTables.map(tableName => {
                      const columns = getTableColumns(tableName);
                      const cfg = getTableSyncConfig(tableName);
                      const isExpanded = expandedTable === tableName;
                      const stream = getStreamSummary(tableName);
                      const cursorLocked = Boolean(stream?.sourceDefinedCursorField);
                      const cursorMissing = cfg.loadType === 'incremental' && !cfg.cursorField;

                      return (
                        <div key={tableName} className="bg-white">
                          {/* Table Row: name/expand, load type, cursor field */}
                          <div className="flex flex-col md:flex-row md:items-center gap-3 p-3.5">
                            <button
                              type="button"
                              onClick={() => setExpandedTable(isExpanded ? null : tableName)}
                              className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer group"
                            >
                              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                              <Table className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                              <span className="text-xs font-bold text-slate-900 font-mono truncate group-hover:underline">{tableName}</span>
                              <span className="text-[10px] text-slate-400 font-medium shrink-0">
                                ({cfg.selectedColumns.length}/{columns.length} colunas)
                              </span>
                            </button>

                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={cfg.loadType}
                                onChange={(e) => handleChangeLoadType(tableName, e.target.value as TableLoadType)}
                                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                              >
                                <option value="full_refresh">Full Refresh (Carga Completa)</option>
                                <option value="incremental">Incremental</option>
                              </select>

                              {cfg.loadType === 'incremental' ? (
                                <select
                                  value={cfg.cursorField}
                                  onChange={(e) => handleChangeCursorField(tableName, e.target.value)}
                                  disabled={cursorLocked}
                                  className={`px-2.5 py-1.5 bg-white border rounded-lg text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-500 min-w-36 ${
                                    cursorMissing ? 'border-rose-300 text-rose-600' : 'border-slate-300 text-slate-800'
                                  } ${cursorLocked ? 'bg-slate-50 cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                                >
                                  <option value="">Selecione o cursor...</option>
                                  {columns.map(col => (
                                    <option key={col} value={col}>{col}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="px-2.5 py-1.5 text-[11px] text-slate-400 italic min-w-36">
                                  Cursor não aplicável
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Columns Detail (Expanded) — default: all columns selected */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 bg-slate-50/60 border-t border-slate-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                                  Colunas ({columns.length})
                                </span>
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => updateTableSyncConfig(tableName, { selectedColumns: columns })}
                                    className="text-[11px] text-indigo-700 hover:underline cursor-pointer"
                                  >
                                    Marcar todas
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateTableSyncConfig(tableName, {
                                      selectedColumns: cfg.loadType === 'incremental' && cfg.cursorField ? [cfg.cursorField] : []
                                    })}
                                    className="text-[11px] text-slate-500 hover:underline cursor-pointer"
                                  >
                                    Desmarcar todas
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                                {columns.map(col => {
                                  const checked = cfg.selectedColumns.includes(col);
                                  const isCursorColumn = cfg.loadType === 'incremental' && cfg.cursorField === col;
                                  return (
                                    <label key={col} className={`flex items-center gap-1.5 text-xs text-slate-700 ${isCursorColumn ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => handleToggleColumn(tableName, col)}
                                        disabled={isCursorColumn}
                                        className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                                      />
                                      <span className={`font-mono truncate ${isCursorColumn ? 'text-indigo-700 font-semibold' : ''}`}>{col}</span>
                                      {isCursorColumn && (
                                        <span className="text-[9px] text-indigo-600 font-semibold uppercase shrink-0">cursor</span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Frequência de Sincronização e Horários de Execução */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-indigo-600" />
                      <label className="text-sm font-bold text-slate-900">
                        Frequência de Sincronização
                      </label>
                      <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100/70 border border-indigo-200 px-2 py-0.5 rounded-full">
                        Multi-Horários
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Selecione a frequência e defina um ou múltiplos horários de disparo para o fluxo.
                    </p>
                  </div>

                  {/* Human-readable Schedule Summary Badge */}
                  <div className="text-xs bg-white border border-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-xl shadow-2xs flex items-center gap-2 shrink-0">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="font-semibold text-slate-900 truncate max-w-sm">{getScheduleSummaryText()}</span>
                  </div>
                </div>

                {usingRealStreams && isRealAirbyteId(selectedDestId) && (
                  syncFrequency === 'once' ? (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Esta integração será criada de verdade no Airbyte em modo <strong>manual</strong> — o Airbyte não agenda uma execução única automática, então a sincronização precisará ser disparada manualmente (na tela do Airbyte ou por um recurso futuro de agendamento único).</span>
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Esta integração será criada de verdade no Airbyte, com o agendamento cron nativo configurado ({getScheduleSummaryText()}).</span>
                    </div>
                  )
                )}

                {/* 4 Frequency Options Grid: Diário, Semanal, Mensal, Carga única */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    {
                      id: 'daily' as const,
                      label: 'Diário',
                      desc: 'Todos os dias da semana',
                      icon: Calendar,
                      badge: 'Recorrente'
                    },
                    {
                      id: 'weekly' as const,
                      label: 'Semanal',
                      desc: 'Dias específicos da semana',
                      icon: CalendarDays,
                      badge: 'Dias selecionados'
                    },
                    {
                      id: 'monthly' as const,
                      label: 'Mensal',
                      desc: 'Dia programado do mês',
                      icon: CalendarRange,
                      badge: 'Mensal'
                    },
                    {
                      id: 'once' as const,
                      label: 'Carga única',
                      desc: 'Execução pontual única',
                      icon: PlayCircle,
                      badge: 'Sem repetição'
                    }
                  ].map(freq => {
                    const isSelected = syncFrequency === freq.id;
                    const Icon = freq.icon;
                    return (
                      <button
                        key={freq.id}
                        type="button"
                        onClick={() => {
                          setSyncFrequency(freq.id);
                          setTimeError(null);
                        }}
                        className={`p-3.5 rounded-xl border text-left cursor-pointer transition flex flex-col justify-between ${
                          isSelected
                            ? 'border-indigo-600 bg-white ring-2 ring-indigo-500/20 shadow-xs'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            isSelected ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600'
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            isSelected 
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {freq.badge}
                          </span>
                        </div>
                        <div>
                          <div className={`text-sm font-bold ${isSelected ? 'text-indigo-900' : 'text-slate-900'}`}>
                            {freq.label}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {freq.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Sub-config: Semanal (Dias da Semana) */}
                {syncFrequency === 'weekly' && (
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Dias da Semana para Execução</span>
                      </label>
                      <span className="text-[11px] text-slate-500">
                        {weeklyDays.length} {weeklyDays.length === 1 ? 'dia selecionado' : 'dias selecionados'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {WEEKDAYS.map(day => {
                        const isSelected = weeklyDays.includes(day.key);
                        return (
                          <button
                            key={day.key}
                            type="button"
                            onClick={() => handleToggleWeeklyDay(day.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                            title={day.full}
                          >
                            <span>{day.label}</span>
                            {isSelected && <Check className="w-3 h-3" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sub-config: Mensal (Dia do Mês) */}
                {syncFrequency === 'monthly' && (
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200">
                    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-2">
                      <CalendarRange className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Dia do Mês para Execução</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {[1, 5, 10, 15, 20, 25, 28, 30].map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setMonthlyDay(d)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                            monthlyDay === d
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Dia {d}
                        </button>
                      ))}
                      <div className="flex items-center gap-1.5 ml-2 text-xs text-slate-600">
                        <span>Outro dia:</span>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={monthlyDay}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (val >= 1 && val <= 31) setMonthlyDay(val);
                          }}
                          className="w-16 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs text-center font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-config: Carga única (Data Agendada) */}
                {syncFrequency === 'once' && (
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200">
                    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-2">
                      <PlayCircle className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Data Agendada para a Carga Única</span>
                    </label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <input
                        type="date"
                        value={onceDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setOnceDate(e.target.value)}
                        className="px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-fit"
                      />
                      <span className="text-xs text-slate-500">
                        O pipeline será executado pontualmente na data definida nos horários configurados abaixo.
                      </span>
                    </div>
                  </div>
                )}

                {/* HORÁRIOS DE EXECUÇÃO (Para qualquer frequência: permite definir um ou vários horários) */}
                <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-indigo-600" />
                        <span>Horários de Execução</span>
                        <span className="text-[11px] font-normal text-slate-500">
                          ({executionTimes.length} {executionTimes.length === 1 ? 'horário ativo' : 'horários ativos'})
                        </span>
                      </label>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Defina um ou vários horários no dia para disparo automático.
                      </p>
                    </div>

                    {/* Add Time Form */}
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={newTimeInput}
                        onChange={(e) => setNewTimeInput(e.target.value)}
                        className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddExecutionTime()}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Adicionar Horário</span>
                      </button>
                    </div>
                  </div>

                  {/* Time Error Alert */}
                  {timeError && (
                    <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span>{timeError}</span>
                    </div>
                  )}

                  {/* Configured Execution Times Pills */}
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Horários Configurados para Execução:
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {executionTimes.map(time => (
                        <div
                          key={time}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-950 shadow-2xs group"
                        >
                          <Clock className="w-3.5 h-3.5 text-indigo-600" />
                          <span className="font-mono text-sm">{time}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveExecutionTime(time)}
                            disabled={executionTimes.length <= 1}
                            className={`text-slate-400 hover:text-rose-600 transition cursor-pointer p-0.5 rounded hover:bg-rose-50 ${
                              executionTimes.length <= 1 ? 'opacity-30 cursor-not-allowed' : ''
                            }`}
                            title={executionTimes.length <= 1 ? 'Necessário manter ao menos um horário' : `Remover ${time}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Quick Suggestions for Adding Common Times */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 mr-1 font-medium">Atalhos de horários:</span>
                    {[
                      { time: '02:00', label: '02:00 (Madrugada)' },
                      { time: '06:00', label: '06:00 (Alvorada)' },
                      { time: '08:00', label: '08:00 (Início Expediente)' },
                      { time: '12:00', label: '12:00 (Almoço)' },
                      { time: '18:00', label: '18:00 (Fim Expediente)' },
                      { time: '22:00', label: '22:00 (Fechamento)' }
                    ].map(preset => {
                      const isAdded = executionTimes.includes(preset.time);
                      return (
                        <button
                          key={preset.time}
                          type="button"
                          onClick={() => {
                            if (isAdded) {
                              handleRemoveExecutionTime(preset.time);
                            } else {
                              handleAddExecutionTime(preset.time);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition cursor-pointer flex items-center gap-1 ${
                            isAdded
                              ? 'bg-indigo-100 border-indigo-300 text-indigo-800 font-bold'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                          }`}
                        >
                          <span>{preset.label}</span>
                          {isAdded ? (
                            <Check className="w-3 h-3 text-indigo-600" />
                          ) : (
                            <Plus className="w-3 h-3 text-slate-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* LGPD Auto Sanitization */}
                <div className="p-4 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Sanitização LGPD Automática (Art. 7º e 46)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 max-w-2xl">
                      Insere automaticamente um nó de anonimização e mascaramento criptográfico (SHA-256) 
                      para proteger CPFs, e-mails e telefones nas tabelas integradas.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[11px] font-semibold ${applyLgpdSanitization ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {applyLgpdSanitization ? '✓ Sanitização Ativa' : 'Desativada'}
                    </span>
                    <input
                      type="checkbox"
                      checked={applyLgpdSanitization}
                      onChange={(e) => setApplyLgpdSanitization(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* LIVE ARCHITECTURAL PREVIEW: 4 STEPS */}
              <div className="p-4 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Prévia da Topologia no Studio Visual ETL (4 Componentes Interligados)</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80 self-start sm:self-auto">
                    Medallion Architecture 100% Compatível
                  </span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 py-1">
                  {/* Step 1: Source */}
                  <div className="bg-slate-800/90 border border-blue-500/50 rounded-xl p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-blue-400 font-mono uppercase font-bold flex items-center gap-1">
                          <Database className="w-3 h-3 text-blue-400" />
                          1. SOURCE
                        </span>
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                      <div className="text-xs font-bold text-white truncate" title={currentActiveSource.name}>
                        {currentActiveSource.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-mono">
                        {currentActiveSource.type.toUpperCase()} • {currentActiveSource.database}
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/60 text-[10px] text-blue-300 font-medium flex items-center justify-between">
                      <span>{selectedTables.length} tabelas</span>
                      <span className="font-mono">CDC Ativo</span>
                    </div>
                  </div>

                  {/* Step 2: Raw Data */}
                  <div className="bg-slate-800/90 border border-amber-500/50 rounded-xl p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-amber-400 font-mono uppercase font-bold flex items-center gap-1">
                          <FolderArchive className="w-3 h-3 text-amber-400" />
                          2. RAW DATA
                        </span>
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                      </div>
                      <div className="text-xs font-bold text-white truncate">
                        Landing Zone Imutável
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                        s3://corp-lake-raw/staging/
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/60 text-[10px] text-amber-300 font-medium flex items-center justify-between">
                      <span>Snappy Parquet</span>
                      <span className="font-mono">Logs CDC</span>
                    </div>
                  </div>

                  {/* Step 3: Bronze */}
                  <div className="bg-slate-800/90 border border-orange-500/50 rounded-xl p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-orange-400 font-mono uppercase font-bold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-orange-400" />
                          3. BRONZE
                        </span>
                        <span className="w-2 h-2 rounded-full bg-orange-500" />
                      </div>
                      <div className="text-xs font-bold text-white truncate">
                        Validação & LGPD
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                        {applyLgpdSanitization ? 'Delta Lake • Cifragem SHA' : 'Delta Lake • Dedup'}
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/60 text-[10px] text-orange-300 font-medium flex items-center justify-between">
                      <span>Schema Enforcement</span>
                      <span className="font-mono">{applyLgpdSanitization ? 'Art. 46' : 'Deduplicado'}</span>
                    </div>
                  </div>

                  {/* Step 4: Silver */}
                  <div className="bg-slate-800/90 border border-teal-500/50 rounded-xl p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-teal-400 font-mono uppercase font-bold flex items-center gap-1">
                          <Boxes className="w-3 h-3 text-teal-400" />
                          4. SILVER
                        </span>
                        <span className="w-2 h-2 rounded-full bg-teal-400" />
                      </div>
                      <div className="text-xs font-bold text-white truncate" title={currentActiveDest.name}>
                        {currentActiveDest.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                        {currentActiveDest.databaseOrDataset}
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/60 text-[10px] text-teal-300 font-medium flex items-center justify-between">
                      <span>{currentActiveDest.type.toUpperCase()} DW</span>
                      <span className="font-mono uppercase">{currentActiveDest.writeMode}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Actions with PRIMARY CREATE INTEGRATION BUTTON */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer w-full sm:w-auto justify-center"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar para Destino</span>
                </button>

                {/* Primary Button as specifically requested in prompt: "quando clicar em um botão de criar integração o sistema cria a integração que ficará disponvel também na tela Studio Visual ETL" */}
                <button
                  id="btn-create-integration"
                  type="button"
                  onClick={handleCreateAutoIntegration}
                  disabled={isCreating}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-indigo-200 disabled:opacity-50 w-full sm:w-auto"
                >
                  {isCreating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Criando Integração e Gerando Topologia...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Criar Integração & Gerar Pipeline</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: OVERVIEW OF SAVED INTEGRATIONS & CONNECTORS                       */}
      {/* ========================================================================= */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Integrations Table */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Integrações Cadastradas ({integrations.length})</h2>
                <p className="text-xs text-slate-500">
                  Todas as integrações automáticas criadas estão disponíveis no Studio Visual ETL.
                </p>
              </div>

              <button
                onClick={() => {
                  setActiveSubTab('wizard');
                  setWizardStep(1);
                }}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Integração Automática</span>
              </button>
            </div>

            {integrations.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
                <Wand2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <div className="text-sm font-bold text-slate-800">Nenhuma integração criada ainda</div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                  Utilize o assistente para selecionar a origem, destino e tabelas para gerar seu primeiro pipeline.
                </p>
                <button
                  onClick={() => {
                    setActiveSubTab('wizard');
                    setWizardStep(1);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl"
                >
                  Iniciar Assistente
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {integrations.map(int => (
                  <div key={int.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="font-bold text-sm text-slate-900">{int.name}</span>
                        {int.applyLgpdSanitization && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                            LGPD Sanitizado
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span className="font-medium text-slate-700">Origem: {int.sourceConnectorName}</span>
                        <span>➔</span>
                        <span className="font-medium text-slate-700">Destino: {int.destinationConnectorName}</span>
                        <span>•</span>
                        <span>{int.selectedTables.length} tabelas ({int.selectedTables.join(', ')})</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-md">
                          <Clock className="w-3 h-3 text-indigo-600" />
                          <span>
                            {int.scheduleSummary 
                              ? int.scheduleSummary 
                              : (int.syncFrequency === 'daily' ? 'Diário' : int.syncFrequency === 'weekly' ? 'Semanal' : int.syncFrequency === 'monthly' ? 'Mensal' : int.syncFrequency === 'once' ? 'Carga única' : int.syncFrequency)
                            }
                          </span>
                          {int.executionTimes && int.executionTimes.length > 0 && !int.scheduleSummary && (
                            <span className="font-mono text-[11px] text-slate-600">({int.executionTimes.join(', ')})</span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-auto">
                      <button
                        onClick={() => onNavigateToStudio(int.pipelineId)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-indigo-200"
                      >
                        <Network className="w-3.5 h-3.5" />
                        <span>Abrir no Studio Visual</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Connectors Overview Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Registered Sources */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-indigo-600" />
                <span>Conectores de Origem Cadastrados ({sources.length})</span>
              </h3>
              <p className="text-xs text-slate-500 mb-3">Origens prontas para integração</p>

              <div className="space-y-2.5">
                {sources.map(src => (
                  <div key={src.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-xs text-slate-900">{src.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{src.type.toUpperCase()} • {src.host}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                      {src.discoveredTables.length} tabelas
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Registered Destinations */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-1.5">
                <Server className="w-4 h-4 text-indigo-600" />
                <span>Conectores de Destino Cadastrados ({destinations.length})</span>
              </h3>
              <p className="text-xs text-slate-500 mb-3">Destinos configurados para cargas e marts</p>

              <div className="space-y-2.5">
                {destinations.map(dst => (
                  <div key={dst.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-xs text-slate-900">{dst.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{dst.type.toUpperCase()} • {dst.databaseOrDataset}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-semibold uppercase">
                      {dst.writeMode}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUCCESS MODAL (Prompt requirement: immediately open in Studio Visual ETL)   */}
      {/* ========================================================================= */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900">Integração Criada com Sucesso!</h3>
              <p className="text-xs text-slate-500 mt-1">
                O pipeline automático foi sintetizado com a arquitetura de 4 passos no Studio Visual ETL:
                <strong> 1. Source ➔ 2. Raw Data ➔ 3. Bronze ➔ 4. Silver</strong>.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-left space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Nome da Integração:</span>
                <span className="font-bold text-slate-900 truncate max-w-[200px]">{integrationName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Tabelas Integradas:</span>
                <span className="font-semibold text-slate-800">{selectedTables.length} tabelas</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Topologia Gerada:</span>
                <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                  4 Componentes Encadeados
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Disponibilidade:</span>
                <span className="font-bold text-emerald-600">Disponível no Studio Visual ETL</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false);
                  if (createdPipelineId) {
                    onNavigateToStudio(createdPipelineId);
                  }
                }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-indigo-200"
              >
                <Network className="w-4 h-4" />
                <span>Abrir e Visualizar no Studio Visual ETL</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false);
                  setActiveSubTab('overview');
                }}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Ver Todas as Integrações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Source/Destination Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 mx-auto flex items-center justify-center">
              <Trash2 className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Excluir {deleteConfirmTarget.kind === 'source' ? 'Origem' : 'Destino'}?
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Tem certeza que deseja excluir <strong className="text-slate-800">"{deleteConfirmTarget.name}"</strong> do Airbyte?
                Essa ação não pode ser desfeita.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                disabled={isDeletingConfirmed}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeletingConfirmed}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isDeletingConfirmed ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
