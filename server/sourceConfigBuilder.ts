export function buildSourceConfiguration(sourceType: string, config: Record<string, unknown>): Record<string, unknown> {
  switch (sourceType) {
    case 'postgres':
      return {
        sourceType,
        host: config.host,
        port: Number(config.port),
        database: config.database,
        username: config.username,
        password: config.password,
        schemas: [String(config.schema || 'public')],
        ssl_mode: { mode: config.ssl ? 'require' : 'disable' },
        tunnel_method: { tunnel_method: 'NO_TUNNEL' },
        replication_method: { method: 'Standard' },
      };
    case 'mysql':
      return {
        sourceType,
        host: config.host,
        port: Number(config.port),
        database: config.database,
        username: config.username,
        password: config.password,
        ssl_mode: { mode: config.ssl ? 'preferred' : 'disabled' },
        tunnel_method: { tunnel_method: 'NO_TUNNEL' },
        replication_method: { method: 'STANDARD' },
      };
    case 'faker':
      return {
        sourceType,
        count: Number(config.count) || 1000,
        seed: Number(config.seed) || 0,
      };
    case 'google-sheets':
      return {
        sourceType,
        spreadsheetId: config.spreadsheetId,
        credentials: {
          auth_type: 'Service',
          service_account_info: config.serviceAccountJson,
        },
      };
    default:
      throw new Error(`Configuração não implementada para o tipo de origem "${sourceType}".`);
  }
}
