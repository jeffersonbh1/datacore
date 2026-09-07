export type ConnectorFieldType = 'text' | 'number' | 'password' | 'textarea' | 'checkbox';

export interface ConnectorField {
  key: string;
  label: string;
  type: ConnectorFieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
}

export interface SourceCatalogEntry {
  id: string;
  label: string;
  description: string;
  airbyteSourceType: string;
  fields: ConnectorField[];
}

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  {
    id: 'postgres',
    label: 'PostgreSQL',
    description: 'RDS / Cloud SQL / Supabase',
    airbyteSourceType: 'postgres',
    fields: [
      { key: 'host', label: 'Host / Endpoint', type: 'text', required: true, placeholder: 'db-oltp.production.aws.com' },
      { key: 'port', label: 'Porta', type: 'number', required: true, defaultValue: 5432 },
      { key: 'database', label: 'Banco de Dados', type: 'text', required: true },
      { key: 'username', label: 'Usuário', type: 'text', required: true },
      { key: 'password', label: 'Senha', type: 'password', required: true },
      { key: 'schema', label: 'Schema', type: 'text', defaultValue: 'public' },
      { key: 'ssl', label: 'Conexão SSL/TLS', type: 'checkbox', defaultValue: true },
    ],
  },
  {
    id: 'mysql',
    label: 'MySQL',
    description: 'Aurora / Relational',
    airbyteSourceType: 'mysql',
    fields: [
      { key: 'host', label: 'Host / Endpoint', type: 'text', required: true },
      { key: 'port', label: 'Porta', type: 'number', required: true, defaultValue: 3306 },
      { key: 'database', label: 'Banco de Dados', type: 'text', required: true },
      { key: 'username', label: 'Usuário', type: 'text', required: true },
      { key: 'password', label: 'Senha', type: 'password', required: true },
      { key: 'ssl', label: 'Conexão SSL/TLS', type: 'checkbox', defaultValue: true },
    ],
  },
  {
    id: 'faker',
    label: 'Faker (Dados de Teste)',
    description: 'Gera dados fake instantaneamente — ideal para testes',
    airbyteSourceType: 'faker',
    fields: [
      { key: 'count', label: 'Quantidade de Registros', type: 'number', required: true, defaultValue: 1000 },
      { key: 'seed', label: 'Seed (opcional)', type: 'number', defaultValue: 0 },
    ],
  },
  {
    id: 'google-sheets',
    label: 'Google Sheets',
    description: 'Planilhas Google via Service Account',
    airbyteSourceType: 'google-sheets',
    fields: [
      { key: 'spreadsheetId', label: 'ID ou URL da Planilha', type: 'text', required: true },
      { key: 'serviceAccountJson', label: 'Credenciais (Service Account JSON)', type: 'textarea', required: true },
    ],
  },
];
