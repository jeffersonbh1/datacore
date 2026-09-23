import React, { useState } from 'react';
import { Link2, Copy, Check, X } from 'lucide-react';

interface LinkAcessoCardProps {
  nome: string;
  email: string;
  link: string;
  onClose?: () => void;
}

/**
 * Link de uso único para o usuário criar a própria senha. Ainda não há SMTP
 * próprio, então o admin copia e envia pelo canal que preferir.
 */
export const LinkAcessoCard: React.FC<LinkAcessoCardProps> = ({ nome, email, link, onClose }) => {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard bloqueado (http, permissão): seleciona o texto para Ctrl+C.
      const el = document.getElementById('link-acesso-input') as HTMLInputElement | null;
      el?.select();
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  return (
    <div className="p-5 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Link2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-indigo-900">Link de acesso para {nome}</p>
            <p className="text-[11px] text-indigo-800/80 mt-0.5">
              Envie este link para <strong>{email}</strong> (WhatsApp, Teams, e-mail…). Ao abrir, a pessoa cria a própria senha
              e entra no DataCore. O link só pode ser usado uma vez e expira — se vencer, gere outro em <strong>Usuários</strong>.
            </p>
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="p-1 text-indigo-400 hover:text-indigo-700 rounded-md cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          id="link-acesso-input"
          type="text"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 px-3 py-2 bg-white border border-indigo-200 rounded-lg text-[11px] font-mono text-slate-700 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={copiar}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
        >
          {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
};
