import React, { useState } from 'react';
import { 
  Mail, Key, Eye, EyeOff, 
  ArrowRight, AlertCircle, RefreshCw, ShieldCheck,
  Database, CheckCircle2, HelpCircle
} from 'lucide-react';
import { TeamUser, UserRole } from '../../types';
import { INITIAL_USERS } from '../../data/initialData';
import { DataCoreLogo } from '../common/DataCoreLogo';
import { isSupabaseConfigured, loginWithSupabaseAuth, supabase } from '../../lib/supabase';

interface LoginScreenProps {
  onLogin: (user: TeamUser, role: UserRole) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const supabaseReady = isSupabaseConfigured();

  const handleForgotPassword = async () => {
    setError(null);
    setResetMessage(null);

    if (!supabaseReady || !supabase) {
      alert('Para redefinição de credenciais corporativas, contate o administrador da plataforma em secops@datacore.io');
      return;
    }
    if (!email.trim()) {
      setError('Informe seu e-mail no campo acima antes de solicitar a redefinição de senha.');
      return;
    }

    setIsSendingReset(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    setIsSendingReset(false);

    // Supabase doesn't reveal whether the email exists (avoids leaking which
    // addresses are registered) — the same message covers both cases.
    if (resetError) {
      setError(resetError.message);
    } else {
      setResetMessage('Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha.');
    }
  };

  // Authenticate submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const inputUser = email.trim();
    const inputPass = password.trim();

    if (!inputUser) {
      setError('Por favor, informe seu usuário ou e-mail corporativo.');
      return;
    }

    if (!inputPass) {
      setError('Por favor, informe sua senha de acesso.');
      return;
    }

    setIsLoading(true);

    // Autenticação via sessão real do Supabase Auth (Fase 4)
    if (supabaseReady) {
      try {
        const { user, role } = await loginWithSupabaseAuth(inputUser, inputPass);
        setIsLoading(false);
        onLogin(user, role);
      } catch (err: unknown) {
        setIsLoading(false);
        const errMsg = err instanceof Error ? err.message : 'Falha na autenticação com o Supabase.';
        setError(errMsg);
      }
    } else {
      // Fallback local authentication while credentials are not provided
      setTimeout(() => {
        const foundUser = INITIAL_USERS.find(
          u => u.email.toLowerCase() === inputUser.toLowerCase() || 
               u.name.toLowerCase() === inputUser.toLowerCase()
        ) || {
          id: `u-${Date.now()}`,
          name: inputUser.includes('@') ? inputUser.split('@')[0].replace('.', ' ') : inputUser,
          email: inputUser.includes('@') ? inputUser : `${inputUser.toLowerCase().replace(/\s+/g, '')}@empresa.com.br`,
          role: 'admin' as UserRole,
          department: 'Engenharia de Dados',
          avatar: inputUser.substring(0, 2).toUpperCase(),
          lastActive: 'Agora mesmo',
          mfaEnabled: false,
          canViewUnmaskedPII: true
        };

        setIsLoading(false);
        onLogin(foundUser, foundUser.role);
      }, 500);
    }
  };

  return (
    <div id="login-screen-container" className="min-h-screen w-full bg-[#f8fafc] text-slate-900 flex flex-col justify-between relative overflow-hidden font-sans select-none">
      {/* Background Decorative Grid */}
      <div 
        className="absolute inset-0 opacity-[0.35] pointer-events-none" 
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }} 
      />

      {/* Center Authentication Card Section - Exclusively the Access Box */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-7 sm:p-9 shadow-sm relative">
            
            {/* Card Header with DataCore Logo Lockup */}
            <div className="mb-7 text-center flex flex-col items-center">
              <div className="mb-4">
                <DataCoreLogo 
                  size="md" 
                  layout="stage" 
                  showWordmark={true} 
                  showTagline={true} 
                />
              </div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                Acesso à Plataforma
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Informe seu usuário e senha para acessar o console
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {resetMessage && (
              <div className="mb-5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{resetMessage}</span>
              </div>
            )}

            {/* Credentials Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Usuário ou E-mail Corporativo
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="login-input-email"
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@empresa.com.br"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#0FA98F] focus:ring-1 focus:ring-[#0FA98F] transition"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Senha de Acesso
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={isSendingReset}
                    className="text-[11px] text-[#0FA98F] hover:text-[#0c8e78] transition cursor-pointer font-medium disabled:opacity-50"
                  >
                    {isSendingReset ? 'Enviando...' : 'Esqueceu a senha?'}
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Key className="w-4 h-4" />
                  </div>
                  <input
                    id="login-input-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
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

              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded bg-white border-slate-300 text-[#0FA98F] focus:ring-[#0FA98F] cursor-pointer"
                  />
                  <span className="text-slate-600 text-[11px]">Lembrar dispositivo</span>
                </label>
              </div>

              <button
                id="btn-submit-login"
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-[#0FA98F] hover:bg-[#0c8e78] text-white rounded-lg font-semibold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Autenticando no {supabaseReady ? 'Supabase' : 'DataCore'}...</span>
                  </>
                ) : (
                  <>
                    <span>Entrar no DataCore</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Quick Demo Credentials Assistant (only if Supabase not yet configured) */}
            {!supabaseReady && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                    Acesso Rápido de Teste (Demo)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSetupGuide(true)}
                    className="text-[11px] text-[#0FA98F] hover:underline flex items-center gap-1"
                  >
                    <HelpCircle className="w-3 h-3" />
                    <span>Conectar Supabase</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('ana.silva@datacore.io');
                      setPassword('senha123456');
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left text-[11px] text-slate-700 transition cursor-pointer"
                  >
                    <div className="font-semibold text-slate-800">Admin</div>
                    <div className="text-[10px] text-slate-400 truncate">ana.silva@...</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('carlos.mendes@datacore.io');
                      setPassword('senha123456');
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left text-[11px] text-slate-700 transition cursor-pointer"
                  >
                    <div className="font-semibold text-slate-800">Data Engineer</div>
                    <div className="text-[10px] text-slate-400 truncate">carlos.mendes@...</div>
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* Supabase Setup Modal Guide */}
      {showSetupGuide && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <Database className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Como Conectar ao Supabase</h4>
                  <p className="text-xs text-slate-500">Configuração das credenciais e banco de dados</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSetupGuide(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-600">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">1</span>
                  No painel do seu Supabase
                </div>
                <p className="text-slate-600">
                  Acesse <strong className="text-slate-900">Project Settings</strong> → <strong className="text-slate-900">API</strong> e copie as duas chaves:
                </p>
                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-slate-700 font-mono text-[11px]">
                  <li>Project URL (ex: https://xyz.supabase.co)</li>
                  <li>Project API Anon Key (chave pública do navegador)</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">2</span>
                  No arquivo .env da aplicação
                </div>
                <p className="text-slate-600 mb-1.5">
                  Insira os valores correspondentes:
                </p>
                <pre className="p-2.5 rounded bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto select-all">
                  VITE_SUPABASE_URL=https://seu-projeto.supabase.co{'\n'}
                  VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">3</span>
                  Autenticação real via Supabase Auth
                </div>
                <p className="text-slate-600 mb-1.5">
                  Login e senha são geridos inteiramente pelo <strong className="text-slate-900 font-mono">Supabase Auth</strong> — a senha nunca passa pelas tabelas da aplicação. A tabela <strong className="text-slate-900 font-mono">public.usuarios</strong> guarda só o perfil (papel, empresa, permissões), vinculado à identidade real por <code className="font-mono text-slate-800">auth_user_id</code>.
                </p>
                <p className="text-[11px] text-slate-500">
                  Novas contas são criadas pelo administrador em <strong>Segurança &amp; RBAC → Cadastrar Usuário</strong>, que usa a Admin API do Supabase Auth (via o gateway, com a service role key) para provisionar o login e o perfil juntos.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-100 text-indigo-900">
                <div className="font-semibold mb-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Pronto!</span>
                </div>
                <p className="text-[11px] text-indigo-800">
                  Ao salvar o arquivo <code className="font-mono bg-white px-1 py-0.5 rounded border border-indigo-200">.env</code>, o DataCore detectará o Supabase automaticamente e a barra de status exibirá o badge verde.
                </p>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSetupGuide(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Legal & Security Status */}
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
