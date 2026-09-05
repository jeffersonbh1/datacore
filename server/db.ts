import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL não definida. Configure o arquivo .env na raiz do projeto (veja .env.example).'
  );
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

pool.on('error', (err) => {
  console.error('Erro inesperado em cliente ocioso do pool Postgres:', err);
});
