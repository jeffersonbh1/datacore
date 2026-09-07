import type { NextFunction, Request, Response } from 'express';

export function requireGatewayApiKey(req: Request, res: Response, next: NextFunction) {
  const expectedKey = process.env.GATEWAY_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'GATEWAY_API_KEY não configurada no servidor.' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const providedKey = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!providedKey || providedKey !== expectedKey) {
    res.status(401).json({ error: 'Chave de acesso ausente ou inválida.' });
    return;
  }

  next();
}
