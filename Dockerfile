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
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
COPY dbt ./dbt
# Pacotes dbt (dbt_utils) fora de /app/dbt — server/dbtRunner.ts também aponta
# DBT_PACKAGES_INSTALL_PATH para cá, então o `dbt deps` do build é reaproveitado
# em runtime (sem re-instalar na 1ª requisição).
ENV DBT_PACKAGES_INSTALL_PATH=/app/dbt_packages
RUN pip3 install --no-cache-dir --break-system-packages -r dbt/requirements.txt \
 && dbt deps --project-dir ./dbt --profiles-dir ./dbt
ENV DBT_PROJECT_DIR=/app/dbt \
    DBT_PROFILES_DIR=/app/dbt \
    DBT_TARGET=prod \
    DBT_GENERATED_ENABLED=true \
    DBT_DEMO_ENABLED=false
# -----------------------------------------------------------------------------

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist

EXPOSE 8080
CMD ["node", "server/dist/index.mjs"]
