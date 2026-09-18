import { chmodSync, copyFileSync, existsSync } from 'fs';

/** Onde o Secret Manager monta a deploy key (--set-secrets, ver cloudbuild.gateway.yaml). */
const MOUNTED_SECRET_PATH = '/secrets/dbt-codegen-deploy-key';
/** Cópia privada que o SSH aceita — arquivos montados de secret vêm com permissão
 *  aberta (leitura por todos), e o `ssh` do OpenSSH recusa carregar uma chave
 *  privada nessas condições ("UNPROTECTED PRIVATE KEY FILE"). Ver GIT_SSH_COMMAND
 *  no Dockerfile, que aponta pra este caminho em vez do original. */
export const DEPLOY_KEY_PATH = '/tmp/dbt_codegen_deploy_key';

/** Roda uma vez no boot do gateway (ver server/index.ts) — sem isso, todo
 *  `git push` de DBT_CODEGEN_GIT=push falha com "Permission denied (publickey)"
 *  mesmo com a deploy key certa, só por causa do modo do arquivo montado. */
export function prepareGitDeployKey(): void {
  if (!existsSync(MOUNTED_SECRET_PATH)) return;
  copyFileSync(MOUNTED_SECRET_PATH, DEPLOY_KEY_PATH);
  chmodSync(DEPLOY_KEY_PATH, 0o600);
}
