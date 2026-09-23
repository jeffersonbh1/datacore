import {
  Pipeline, AlertRule, Incident, LGPDRequest,
  TeamUser, RolePermissions, ExecutionLog,
  SourceConnectorConfig, DestinationConnectorConfig, AutoIntegration
} from '../types';

export const INITIAL_LOGS: ExecutionLog[] = [
  {
    id: 'log-101',
    timestamp: '15:42:12',
    pipelineId: 'pipe-ecommerce-bq',
    pipelineName: 'Pipeline Vendas & Transações E-Commerce',
    level: 'info',
    message: 'Lote de streaming 24021 ingerido com sucesso: 12.450 mensagens processadas em 48ms.'
  },
  {
    id: 'log-102',
    timestamp: '15:42:08',
    pipelineId: 'pipe-ecommerce-bq',
    pipelineName: 'Pipeline Vendas & Transações E-Commerce',
    level: 'security',
    message: 'Sanitizador LGPD: 12.450 CPFs e Cartões mascarados via Token Vault e SHA-256 conforme política corporativa.'
  },
  {
    id: 'log-103',
    timestamp: '15:40:55',
    pipelineId: 'pipe-telemetria-iot',
    pipelineName: 'Telemetria IoT & Logs em Tempo Real',
    level: 'info',
    message: 'Cluster Kafka partition-rebalance concluído sem degradação de throughput. 42k eventos/seg.'
  },
  {
    id: 'log-104',
    timestamp: '15:35:10',
    pipelineId: 'pipe-crm-snowflake',
    pipelineName: 'Customer 360 Ingestão & Mascaramento PII',
    level: 'warn',
    message: 'Taxa de registros com campos nulos em "telefone" atingiu 4.2% na API Salesforce.'
  },
  {
    id: 'log-105',
    timestamp: '15:20:00',
    pipelineId: 'pipe-rh-folha',
    pipelineName: 'Folha de Pagamento & Benefícios RH Seguro',
    level: 'security',
    message: 'Auditoria de Acesso: Usuário "Beatriz Lima" (DPO) validou schema com dados criptografados.'
  }
];

export const INITIAL_ALERT_RULES: AlertRule[] = [
  {
    id: 'rule-1',
    name: 'Alerta de Latência Crítica de Streaming',
    pipelineId: 'pipe-ecommerce-bq',
    metric: 'latency',
    threshold: '> 500ms por mais de 3 minutos consecutivos',
    channels: ['slack', 'pagerduty'],
    enabled: true,
    severity: 'critical'
  },
  {
    id: 'rule-2',
    name: 'Tentativa de Escoamento de PII sem Mascaramento',
    metric: 'pii_leak_attempt',
    threshold: 'Detecção de CPF ou Cartão em nó sem regra LGPD ativa',
    channels: ['slack', 'email', 'pagerduty'],
    enabled: true,
    severity: 'critical'
  },
  {
    id: 'rule-3',
    name: 'Pico Anômalo de Custo FinOps',
    metric: 'cost_spike',
    threshold: 'Gasto diário > 25% acima da média móvel de 7 dias',
    channels: ['email', 'slack'],
    enabled: true,
    severity: 'high'
  },
  {
    id: 'rule-4',
    name: 'Taxa de Falha em Ingestão Batch',
    metric: 'failure_rate',
    threshold: 'Taxa de erro > 2% durante execução de job',
    channels: ['slack'],
    enabled: true,
    severity: 'medium'
  }
];

export const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'inc-301',
    title: 'Atraso na Sincronização da Snowpipe (Snowflake)',
    pipelineName: 'Customer 360 Ingestão & Mascaramento PII',
    severity: 'medium',
    status: 'acknowledged',
    createdAt: 'Há 45 minutos',
    description: 'Fila de arquivos no S3 intermediário aumentou de 12 para 48 arquivos aguardando ingestão no Snowflake.'
  },
  {
    id: 'inc-302',
    title: 'Autenticação Temporária Expirada em Webhook de Vendas',
    pipelineName: 'Pipeline Vendas & Transações E-Commerce',
    severity: 'high',
    status: 'resolved',
    createdAt: 'Há 3 horas',
    description: 'Certificado mTLS do gateway de pagamento foi renovado com sucesso pelo orchestrator.'
  }
];

export const INITIAL_LGPD_REQUESTS: LGPDRequest[] = [
  {
    id: 'DSR-2026-089',
    titularName: 'Ana Clara Vasconcelos',
    documentType: 'CPF',
    documentValue: '482.109.328-44',
    requestType: 'esquecimento',
    status: 'em_analise',
    dateRequested: '01/09/2026',
    deadlineDate: '15/09/2026 (15 dias úteis Art. 19)',
    legalBasis: 'Revogação de Consentimento Marketing',
    affectedPipelines: ['Customer 360 Ingestão & Mascaramento PII', 'Pipeline Vendas & Transações E-Commerce'],
    auditNotes: 'Verificação em andamento: dados de faturamento devem ser retidos por 5 anos (obrigação fiscal - Art. 16, I).'
  },
  {
    id: 'DSR-2026-088',
    titularName: 'Marcos Vinícius Silveira',
    documentType: 'CPF',
    documentValue: '109.432.871-90',
    requestType: 'portabilidade',
    status: 'executado',
    dateRequested: '28/08/2026',
    deadlineDate: '12/09/2026',
    legalBasis: 'Portabilidade Art. 18, V',
    affectedPipelines: ['Customer 360 Ingestão & Mascaramento PII'],
    auditNotes: 'Arquivo JSON interoperável criptografado gerado e enviado com chave assimétrica ao titular.'
  },
  {
    id: 'DSR-2026-087',
    titularName: 'Letícia Prado Campos',
    documentType: 'Email',
    documentValue: 'leticia.prado@advocacia.com.br',
    requestType: 'acesso',
    status: 'executado',
    dateRequested: '22/08/2026',
    deadlineDate: '06/09/2026',
    legalBasis: 'Confirmação e Acesso Art. 18, I e II',
    affectedPipelines: ['Customer 360 Ingestão & Mascaramento PII'],
    auditNotes: 'Relatório completo de dados tratados emitido pelo DPO.'
  }
];

export const INITIAL_USERS: TeamUser[] = [
  {
    id: 'u-1',
    name: 'Jefferson Barbosa',
    email: 'jeffersonbh1@gmail.com',
    role: 'admin',
    department: 'Arquitetura de Dados & Cloud',
    avatar: 'JB',
    lastActive: 'Agora mesmo',
    mfaEnabled: true,
    canViewUnmaskedPII: true
  },
  {
    id: 'u-2',
    name: 'Carlos Silva',
    email: 'carlos.silva@empresa.com.br',
    role: 'data_engineer',
    department: 'Engenharia de Plataforma',
    avatar: 'CS',
    lastActive: 'Há 5 minutos',
    mfaEnabled: true,
    canViewUnmaskedPII: false
  },
  {
    id: 'u-3',
    name: 'Beatriz Lima',
    email: 'beatriz.dpo@empresa.com.br',
    role: 'dpo_compliance',
    department: 'Governança, Risco & Compliance (LGPD)',
    avatar: 'BL',
    lastActive: 'Há 22 minutos',
    mfaEnabled: true,
    canViewUnmaskedPII: true
  },
  {
    id: 'u-4',
    name: 'Mariana Duarte',
    email: 'mariana.duarte@empresa.com.br',
    role: 'data_engineer',
    department: 'Engenharia de Dados',
    avatar: 'MD',
    lastActive: 'Há 1 hora',
    mfaEnabled: true,
    canViewUnmaskedPII: false
  },
  {
    id: 'u-5',
    name: 'Tiago Santos',
    email: 'tiago.analista@empresa.com.br',
    role: 'data_analyst',
    department: 'Business Intelligence & Insights',
    avatar: 'TS',
    lastActive: 'Há 3 horas',
    mfaEnabled: false,
    canViewUnmaskedPII: false
  }
];

export const ROLE_DEFINITIONS: Record<string, RolePermissions> = {
  admin: {
    role: 'admin',
    name: 'Administrador Global',
    description: 'Controle irrestrito sobre pipelines, infraestrutura cloud, segurança, RBAC e faturamento.',
    permissions: {
      canCreatePipelines: true,
      canEditPipelines: true,
      canTriggerExecutions: true,
      canViewPipelines: true,
      canViewRawPII: true,
      canConfigureLGPDRules: true,
      canManageAlerts: true,
      canViewFinOps: true,
      canManageUsers: true
    }
  },
  data_engineer: {
    role: 'data_engineer',
    name: 'Engenheiro de Dados',
    description: 'Criação, edição e deploy de pipelines visuais ETL, gerenciamento de conectores e otimização técnica.',
    permissions: {
      canCreatePipelines: true,
      canEditPipelines: true,
      canTriggerExecutions: true,
      canViewPipelines: true,
      canViewRawPII: false, // Por padrão, engenheiros vêem dados mascarados para conformidade LGPD
      canConfigureLGPDRules: true,
      canManageAlerts: true,
      canViewFinOps: true,
      canManageUsers: false
    }
  },
  dpo_compliance: {
    role: 'dpo_compliance',
    name: 'DPO / Oficial de Privacidade',
    description: 'Supervisão de conformidade com a LGPD, auditoria de dados sensíveis e atendimento aos titulares.',
    permissions: {
      canCreatePipelines: false,
      canEditPipelines: false,
      canTriggerExecutions: false,
      canViewPipelines: true,
      canViewRawPII: true,
      canConfigureLGPDRules: true,
      canManageAlerts: true,
      canViewFinOps: false,
      canManageUsers: false
    }
  },
  data_analyst: {
    role: 'data_analyst',
    name: 'Analista de Dados / BI',
    description: 'Visualização de pipelines, consulta a schemas e análise de tabelas tratadas com anonimização ativa.',
    permissions: {
      canCreatePipelines: false,
      canEditPipelines: false,
      canTriggerExecutions: false,
      canViewPipelines: true,
      canViewRawPII: false,
      canConfigureLGPDRules: false,
      canManageAlerts: false,
      canViewFinOps: false,
      canManageUsers: false
    }
  },
  viewer: {
    role: 'viewer',
    name: 'Visualizador Externo',
    description: 'Acesso apenas leitura para auditoria externa ou clientes sem capacidade de edição.',
    permissions: {
      canCreatePipelines: false,
      canEditPipelines: false,
      canTriggerExecutions: false,
      canViewPipelines: true,
      canViewRawPII: false,
      canConfigureLGPDRules: false,
      canManageAlerts: false,
      canViewFinOps: false,
      canManageUsers: false
    }
  }
};

export const INITIAL_SOURCES: SourceConnectorConfig[] = [
  {
    id: 'src-postgres-vendas',
    name: 'PostgreSQL Vendas OLTP (AWS RDS)',
    type: 'postgresql',
    provider: 'aws',
    host: 'postgres-sales-prod.c49fk.us-east-1.rds.amazonaws.com',
    port: 5432,
    database: 'vendas_production',
    username: 'etl_reader_svc',
    schema: 'public',
    ssl: true,
    status: 'connected',
    lastTestedAt: 'Há 5 minutos',
    createdAt: '2026-02-15',
    discoveredTables: [
      {
        name: 'clientes',
        rowCount: 54200,
        columns: ['id', 'nome_completo', 'cpf', 'email', 'telefone', 'data_nascimento', 'criado_em'],
        hasPII: true,
        piiFields: ['cpf', 'email', 'telefone', 'nome_completo']
      },
      {
        name: 'pedidos',
        rowCount: 189400,
        columns: ['id', 'cliente_id', 'valor_total', 'status', 'forma_pagamento', 'data_pedido'],
        hasPII: false
      },
      {
        name: 'itens_pedido',
        rowCount: 582000,
        columns: ['id', 'pedido_id', 'produto_id', 'quantidade', 'preco_unitario', 'desconto'],
        hasPII: false
      },
      {
        name: 'pagamentos_cartao',
        rowCount: 189400,
        columns: ['id', 'pedido_id', 'bandeira', 'num_cartao_token', 'cpf_titular', 'valor', 'status'],
        hasPII: true,
        piiFields: ['cpf_titular', 'num_cartao_token']
      },
      {
        name: 'enderecos_entrega',
        rowCount: 48100,
        columns: ['id', 'cliente_id', 'logradouro', 'numero', 'cep', 'cidade', 'estado'],
        hasPII: true,
        piiFields: ['logradouro', 'cep']
      }
    ]
  },
  {
    id: 'src-salesforce-crm',
    name: 'Salesforce CRM Clientes & Leads',
    type: 'salesforce',
    provider: 'generic',
    host: 'enterprise-login.salesforce.com/services/data/v58.0',
    port: 443,
    database: 'EnterpriseOrg_NA14',
    username: 'integration_etl@empresa.com.br',
    schema: 'StandardObjects',
    ssl: true,
    status: 'connected',
    lastTestedAt: 'Há 12 minutos',
    createdAt: '2026-02-20',
    discoveredTables: [
      {
        name: 'Account',
        rowCount: 34100,
        columns: ['Id', 'Name', 'TaxDocument', 'Phone', 'BillingCity', 'AnnualRevenue'],
        hasPII: true,
        piiFields: ['TaxDocument', 'Phone']
      },
      {
        name: 'Contact',
        rowCount: 89500,
        columns: ['Id', 'AccountId', 'FirstName', 'LastName', 'Email', 'MobilePhone', 'Department'],
        hasPII: true,
        piiFields: ['FirstName', 'LastName', 'Email', 'MobilePhone']
      },
      {
        name: 'Opportunity',
        rowCount: 21400,
        columns: ['Id', 'AccountId', 'Amount', 'StageName', 'Probability', 'CloseDate'],
        hasPII: false
      },
      {
        name: 'Lead',
        rowCount: 45000,
        columns: ['Id', 'Name', 'Company', 'Email', 'Phone', 'LeadSource', 'Status'],
        hasPII: true,
        piiFields: ['Name', 'Email', 'Phone']
      }
    ]
  },
  {
    id: 'src-kafka-telemetria',
    name: 'Apache Kafka Telemetria & Eventos',
    type: 'kafka',
    provider: 'generic',
    host: 'pkc-4v18.us-east-2.aws.confluent.cloud',
    port: 9092,
    database: 'cluster-iot-prod',
    username: 'kafka_cdc_reader',
    schema: 'default',
    ssl: true,
    status: 'connected',
    lastTestedAt: 'Há 1 hora',
    createdAt: '2026-02-24',
    discoveredTables: [
      {
        name: 'telemetria_dispositivos',
        rowCount: 4820000,
        columns: ['timestamp', 'device_id', 'temperatura', 'pressao', 'voltagem', 'status'],
        hasPII: false
      },
      {
        name: 'eventos_sessao_usuario',
        rowCount: 1240000,
        columns: ['event_id', 'user_ip', 'user_agent', 'path', 'session_id', 'duration_ms'],
        hasPII: true,
        piiFields: ['user_ip']
      },
      {
        name: 'alertas_criticos',
        rowCount: 15400,
        columns: ['alert_id', 'device_id', 'severity', 'error_code', 'detected_at'],
        hasPII: false
      }
    ]
  }
];

export const INITIAL_DESTINATIONS: DestinationConnectorConfig[] = [
  {
    id: 'dest-bigquery-curated',
    name: 'Google BigQuery Analytics Datalake',
    type: 'bigquery',
    provider: 'gcp',
    accountOrProject: 'corp-datalake-prod-3891',
    warehouseOrCluster: 'US-MULTIREGION',
    databaseOrDataset: 'curated_analytics',
    schema: 'public',
    authMethod: 'service_account',
    writeMode: 'merge_upsert',
    status: 'connected',
    lastTestedAt: 'Há 3 minutos',
    createdAt: '2026-02-10'
  },
  {
    id: 'dest-snowflake-dw',
    name: 'Snowflake Enterprise Data Warehouse',
    type: 'snowflake',
    provider: 'snowflake',
    accountOrProject: 'xy98234.us-east-1',
    warehouseOrCluster: 'COMPUTE_WH_XL',
    databaseOrDataset: 'ENTERPRISE_DW',
    schema: 'PUBLIC',
    authMethod: 'key_pair',
    writeMode: 'append',
    status: 'connected',
    lastTestedAt: 'Há 18 minutos',
    createdAt: '2026-02-12'
  },
  {
    id: 'dest-redshift-lakehouse',
    name: 'AWS Redshift Lakehouse Gold',
    type: 'redshift',
    provider: 'aws',
    accountOrProject: 'aws-account-74120938',
    warehouseOrCluster: 'redshift-cluster-prod-01',
    databaseOrDataset: 'gold_dw',
    schema: 'curated',
    authMethod: 'iam_role',
    writeMode: 'append',
    status: 'connected',
    lastTestedAt: 'Há 2 horas',
    createdAt: '2026-02-18'
  }
];

// Sem seed de exemplo — integrações só existem quando o usuário cria uma de
// verdade (persistida em Supabase e carregada em App.tsx).
export const INITIAL_INTEGRATIONS: AutoIntegration[] = [];

