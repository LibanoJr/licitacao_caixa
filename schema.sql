-- schema.sql — tabelas usadas pelos endpoints /api (Neon Postgres).
-- Seguro rodar mais de uma vez: só cria o que ainda não existe e só
-- acrescenta colunas que faltarem (não apaga nem altera dado existente).
-- Rodar no SQL Editor do Neon (console.neon.tech → seu projeto → SQL Editor).

CREATE TABLE IF NOT EXISTS precificacoes (
  id                      SERIAL PRIMARY KEY,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE precificacoes
  ADD COLUMN IF NOT EXISTS numero_matricula        TEXT,
  ADD COLUMN IF NOT EXISTS endereco_completo       TEXT,
  ADD COLUMN IF NOT EXISTS cidade_identificada     TEXT,
  ADD COLUMN IF NOT EXISTS regiao_identificada     TEXT,
  ADD COLUMN IF NOT EXISTS area_privativa_m2       NUMERIC,
  ADD COLUMN IF NOT EXISTS area_total_m2           NUMERIC,
  ADD COLUMN IF NOT EXISTS vaga_garagem            BOOLEAN,
  ADD COLUMN IF NOT EXISTS preco_m2_utilizado      NUMERIC,
  ADD COLUMN IF NOT EXISTS fonte_preco_m2          TEXT,
  ADD COLUMN IF NOT EXISTS valor_estimado          NUMERIC,
  ADD COLUMN IF NOT EXISTS fator_ajuste            NUMERIC,
  ADD COLUMN IF NOT EXISTS confianca_extracao      TEXT,
  ADD COLUMN IF NOT EXISTS imovel_pertence_caixa   BOOLEAN,
  ADD COLUMN IF NOT EXISTS onus_ativos             JSONB,
  ADD COLUMN IF NOT EXISTS alertas_extracao        JSONB,
  ADD COLUMN IF NOT EXISTS precisa_revisao_manual  BOOLEAN,
  ADD COLUMN IF NOT EXISTS extracao_bruta          JSONB,
  ADD COLUMN IF NOT EXISTS precificacao_bruta      JSONB,
  ADD COLUMN IF NOT EXISTS tempo_total_ms          INTEGER,
  ADD COLUMN IF NOT EXISTS tipo_resposta           TEXT DEFAULT 'estimativa',
  ADD COLUMN IF NOT EXISTS motivo_recusa           TEXT,
  ADD COLUMN IF NOT EXISTS fundamentacao_recusa    TEXT,
  ADD COLUMN IF NOT EXISTS valor_real_avaliado     NUMERIC,
  ADD COLUMN IF NOT EXISTS fonte_valor_real        TEXT;

CREATE INDEX IF NOT EXISTS idx_precificacoes_criado_em ON precificacoes (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_precificacoes_cidade    ON precificacoes (cidade_identificada);

CREATE TABLE IF NOT EXISTS uso_gemini (
  data            DATE PRIMARY KEY,
  total_chamadas  INTEGER NOT NULL DEFAULT 0,
  total_sucesso   INTEGER NOT NULL DEFAULT 0,
  total_erro      INTEGER NOT NULL DEFAULT 0
);
