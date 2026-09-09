import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { DataCoreLogo } from '../common/DataCoreLogo';
import { supabase } from '../../lib/supabase';

interface ResetPasswordScreenProps {
  onPasswordSet: () => void;
}

/**
 * Shown when the app detects a Supabase Auth password-recovery link (Fase 4's
 * "Esqueceu a senha?" flow). The recovery link already authenticates the
 * browser with a temporary session — this screen's only job is to turn that
 * into an actual new password via supabase.auth.updateUser before letting the
 * user into the app, so a recovery link never silently logs someone in
 * without ever changing anything.
 */
export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ onPasswordSet }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (!supabase) {
      setError('Supabase não está configurado.');
      return;
    }

    setIsLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    onPasswordSet();
  };

  return (
    <div id="reset-password-screen-container" className="min-h-screen w-full bg-[#f8fafc] text-slate-900 flex flex-col justify-between relative overflow-hidden font-sans select-none">
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-7 sm:p-9 shadow-sm relative">
            <div className="mb-7 text-center flex flex-col items-center">
              <div className="mb-4">
                <DataCoreLogo size="md" layout="stage" showWordmark={true} showTagline={true} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                Defina sua Nova Senha
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Você acessou por um link de redefinição de senha. Escolha uma senha nova para continuar.
              </p>
            </div>

            {error && (
              <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nova Senha
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reset-input-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#0FA98F] focus:ring-1 focus:ring-[#0FA98F] transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Confirmar Senha
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reset-input-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#0FA98F] focus:ring-1 focus:ring-[#0FA98F] transition"
                  />
                </div>
              </div>

              <button
                id="btn-submit-reset-password"
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-[#0FA98F] hover:bg-[#0c8e78] text-white rounded-lg font-semibold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <span>Salvar Nova Senha e Entrar</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full bg-white border-t border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Segurança em conformidade com ISO/IEC 27001 & LGPD</span>
          </div>
          <div>
            <span>© 2026 DataCore Technologies Inc. Todos os direitos reservados.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
