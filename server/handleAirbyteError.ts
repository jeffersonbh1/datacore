import type { Response } from 'express';
import { AirbyteApiError } from './airbyteClient';

export function handleAirbyteError(res: Response, err: unknown) {
  if (err instanceof AirbyteApiError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message, details: err.body });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Erro interno ao comunicar com o Airbyte.' });
}
