-- =============================================================================
-- Dataset BigQuery por integração (não por destino).
--
-- destinos.configuracao.databaseOrDataset é COMPARTILHADO: a tabela "destinos"
-- tem UNIQUE (id_empresa, airbyte_destination_id), ou seja, uma única linha por
-- destino REAL do Airbyte. Antes desta migração, o campo "Default Dataset ID"
-- do Passo 2 (AutoPipelineView, modo "Usar Destino Existente") era persistido
-- via registrarDestino() nessa mesma linha compartilhada — então criar uma 2ª
-- integração reusando o mesmo destino Airbyte com um dataset diferente
-- SOBRESCREVIA o dataset da 1ª integração (e, ao recarregar a página, as duas
-- integrações passavam a exibir o mesmo dataset/config, mesmo sendo diferentes).
--
-- Esta coluna guarda o dataset ("raw_..." completo) de CADA integração
-- individualmente. NULL = usa o dataset padrão do destino (destino criado só
-- para esta integração, ou destino não-BigQuery).
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..011).
-- =============================================================================

ALTER TABLE integracoes ADD COLUMN IF NOT EXISTS dataset_override TEXT;
