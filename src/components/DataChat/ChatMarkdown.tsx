import React, { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ClipboardCopy } from 'lucide-react';

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 rounded-lg border border-slate-200 overflow-hidden bg-slate-900">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 text-[10px] text-slate-300">
        <span className="font-mono uppercase tracking-wider">{language || 'código'}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard indisponível (contexto não seguro) — só não copia.
            }
          }}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-700 transition cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <ClipboardCopy className="w-3 h-3" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[12px] leading-relaxed text-slate-100 font-mono"><code>{code}</code></pre>
    </div>
  );
}

const components: Components = {
  // Blocos de código chegam como <pre><code class="language-x">; código inline é <code> sem <pre>.
  pre({ children }) {
    const el = React.Children.toArray(children)[0] as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
    const language = /language-(\w+)/.exec(el?.props?.className || '')?.[1] || '';
    const code = String(el?.props?.children ?? '').replace(/\n$/, '');
    return <CodeBlock language={language} code={code} />;
  },
  code({ children }) {
    return <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[12px]">{children}</code>;
  },
  h1: ({ children }) => <h3 className="text-base font-bold text-slate-900 mt-4 mb-2">{children}</h3>,
  h2: ({ children }) => <h3 className="text-sm font-bold text-slate-900 mt-4 mb-1.5">{children}</h3>,
  h3: ({ children }) => <h4 className="text-sm font-semibold text-slate-800 mt-3 mb-1">{children}</h4>,
  h4: ({ children }) => <h4 className="text-sm font-semibold text-slate-800 mt-3 mb-1">{children}</h4>,
  p: ({ children }) => <p className="text-sm text-slate-700 leading-relaxed my-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm text-slate-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm text-slate-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-indigo-200 pl-3 my-2 text-slate-600 italic">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{children}</a>,
  hr: () => <hr className="my-3 border-slate-200" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50 text-slate-600">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 border-b border-slate-100 text-slate-700 align-top">{children}</td>,
};

export const ChatMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
    {text}
  </ReactMarkdown>
);
