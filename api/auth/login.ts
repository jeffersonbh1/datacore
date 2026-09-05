import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser } from '../../server/authService';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: 'Informe e-mail e senha.' });
    return;
  }

  try {
    const result = await authenticateUser(email, password);

    if (!result.ok) {
      const message = result.reason === 'inactive'
        ? 'Cadastro desativado. Contate o administrador.'
        : 'E-mail ou senha inválidos.';
      res.status(401).json({ error: message });
      return;
    }

    res.status(200).json({ user: result.user });
  } catch (err) {
    console.error('Erro ao autenticar usuário:', err);
    res.status(500).json({ error: 'Erro interno ao autenticar. Tente novamente.' });
  }
}
