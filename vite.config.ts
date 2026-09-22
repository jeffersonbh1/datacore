import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // dbt/ is ignored even when watching: the gateway (server/) writes real .sql files
      // there when the Studio Gold dbt editor saves — since .sql isn't part of the JS
      // module graph, Vite would otherwise do a full page reload on every save, wiping
      // out whatever screen/state the user had open (confirmed 2026-09-22: the dbt editor
      // itself appeared to "close" right after clicking Salvar, in local dev only).
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/dbt/**'] },
    },
  };
});
