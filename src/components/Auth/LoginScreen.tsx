import React, { useState } from 'react';
import { Database, Mail, Lock, Unlock, ShieldCheck, LogIn, AlertCircle } from 'lucide-react';
import { TeamUser } from '../../types';

interface LoginScreenProps {
  users: TeamUser[];
  onLoginSuccess: (user: TeamUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ users, onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const matchedUser = users.find(
      (u) => u.email.trim().toLowerCase() === email.trim().toLowerCase()
    );

    if (!matchedUser) {
      setError('E-mail não cadastrado na plataforma.');
      return;
    }

    if (!password) {
      setError('Informe sua senha para continuar.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onLoginSuccess(matchedUser);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-sm shadow-indigo-200">
            <Database className="w-6 h-6 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">DataCore</h1>
            <p className="text-xs text-slate-500">Plataforma de Engenharia de Dados & ETL</p>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-6 sm:p-8">
          <h2 className="text-base font-bold text-slate-900 mb-1">Acesse sua conta</h2>
          <p className="text-xs text-slate-500 mb-6">
            Entre com suas credenciais corporativas para continuar.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                E-mail Corporativo <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  autoComplete="username"
                  className="w-full pl-8 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Senha <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
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

            {/* Remember / Forgot */}
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Lembrar-me
              </label>
              <button
                type="button"
                onClick={() => setError('Entre em contato com o administrador para redefinir sua senha.')}
                className="text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
              >
                Esqueceu a senha?
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-medium px-3 py-2 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-indigo-200 disabled:opacity-50"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? 'Autenticando...' : 'Entrar na Plataforma'}
            </button>
          </form>

          {/* Demo hint */}
          <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-500 leading-relaxed">
            Ambiente de demonstração: utilize um e-mail cadastrado na equipe (ex.:{' '}
            <strong className="text-slate-700 font-mono">jeffersonbh1@gmail.com</strong>) com qualquer senha.
          </div>
        </div>

        {/* Footer security badge */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 mt-5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          Conexão segura • Criptografia AES-256 • Conformidade LGPD
        </div>
      </div>
    </div>
  );
};
