FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
RUN npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# --- dbt (camada Bronze/Silver/Gold) -------------------------------------------
# O gateway invoca `dbt build` via server/dbtRunner.ts. Precisa do CLI do dbt e
# do projeto em /app/dbt. As credenciais vêm em runtime (BIGQUERY_CREDENTIALS_JSON).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates git openssh-client \
 && rm -rf /var/lib/apt/lists/*
COPY dbt ./dbt
# .git precisa estar presente pra DBT_CODEGEN_GIT=commit|push (server/dbtCodegen.ts::
# gitCommit) conseguir commitar/dar push nos modelos gerados em models/medallion/ —
# sem isso, todo modelo criado em produção só existe no disco efêmero do container
# (ver incidente 2026-09-17, arena_fahel_beach). Exige .git também sobrevivendo ao
# upload do `gcloud run deploy --source` — ver .gcloudignore.
COPY .git ./.git
# Host key do GitHub pré-fixada em build time (rede confiável) — evita TOFU
# (StrictHostKeyChecking=accept-new) em runtime a cada cold start.
RUN mkdir -p /app/.ssh \
 && ssh-keyscan -t ed25519 github.com >> /app/.ssh/known_hosts 2>/dev/null
# GIT_SSH_COMMAND usado por gitCommit() ao dar push com a deploy key. Aponta pra
# /tmp (não pro arquivo montado em /secrets direto): secret montada vem com
# permissão aberta e o ssh recusa carregar chave privada nessas condições —
# server/gitDeployKey.ts copia com chmod 600 pra cá no boot (ver server/index.ts).
ENV GIT_SSH_COMMAND="ssh -i /tmp/dbt_codegen_deploy_key -o UserKnownHostsFile=/app/.ssh/known_hosts -o IdentitiesOnly=yes"
# Pacotes dbt (dbt_utils) fora de /app/dbt — server/dbtRunner.ts também aponta
# DBT_PACKAGES_INSTALL_PATH para cá, então o `dbt deps` do build é reaproveitado
# em runtime (sem re-instalar na 1ª requisição).
ENV DBT_PACKAGES_INSTALL_PATH=/app/dbt_packages
RUN pip3 install --no-cache-dir --break-system-packages -r dbt/requirements.txt \
 && dbt deps --project-dir ./dbt --profiles-dir ./dbt
ENV DBT_PROJECT_DIR=/app/dbt \
    DBT_PROFILES_DIR=/app/dbt \
    DBT_TARGET=prod \
    DBT_DEMO_ENABLED=false
# -----------------------------------------------------------------------------

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist

EXPOSE 8080
CMD ["node", "server/dist/index.mjs"]
