// api/fluxo-pareado.js
// Fluxo Pareado (item 19.10 do Anexo I) — calcula estatísticas de
// aderência entre o valor estimado pelo sistema e o valor real avaliado
// (NBR 14653), sobre todos os registros já pareados (valor_real_avaliado
// preenchido via /api/registrar-avaliacao).
//
// GET /api/fluxo-pareado                          → estatísticas gerais
// GET /api/fluxo-pareado?cidade=brasilia-df         → filtra por cidade
// GET /api/fluxo-pareado?dias=30                    → só pares dos últimos N dias (padrão: todos)

import { neon } from "@neondatabase/serverless";

const CONNECTION_STRING =
  process.env.STORAGE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.STORAGE_DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const sql = CONNECTION_STRING ? neon(CONNECTION_STRING) : null;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido. Use GET." });
  }

  if (!sql) {
    return res.status(500).json({ erro: "Variável de conexão do banco não configurada no servidor." });
  }

  try {
    const cidadeFiltro = req.query.cidade ? String(req.query.cidade).toLowerCase().trim() : null;
    const dias = req.query.dias ? Number(req.query.dias) : null;

    const pares = await sql`
      SELECT id, cidade_identificada, regiao_identificada, valor_estimado,
             valor_real_avaliado, criado_em
      FROM precificacoes
      WHERE valor_real_avaliado IS NOT NULL
        AND (${cidadeFiltro}::text IS NULL OR cidade_identificada = ${cidadeFiltro})
        AND (${dias}::int IS NULL OR criado_em >= now() - (${dias}::int || ' days')::interval)
      ORDER BY criado_em DESC
    `;

    if (pares.length === 0) {
      return res.status(200).json({
        total_pares: 0,
        mensagem: "Nenhum par (estimado × real) registrado ainda. Use /api/registrar-avaliacao para adicionar avaliações profissionais aos registros existentes.",
      });
    }

    // MAPE (Mean Absolute Percentage Error) — métrica padrão pra medir
    // o desvio percentual médio entre estimado e real. É o tipo de
    // número que a CAIXA usa pra decidir aprovação no Fluxo Pareado.
    const desvios = pares.map((p) => {
      const erro = (Number(p.valor_estimado) - Number(p.valor_real_avaliado)) / Number(p.valor_real_avaliado);
      return { id: p.id, erroPercentual: erro * 100 };
    });

    const mape = desvios.reduce((soma, d) => soma + Math.abs(d.erroPercentual), 0) / desvios.length;
    const vies = desvios.reduce((soma, d) => soma + d.erroPercentual, 0) / desvios.length; // positivo = superestima em média
    const maiorDesvio = desvios.reduce((max, d) => (Math.abs(d.erroPercentual) > Math.abs(max.erroPercentual) ? d : max));

    // Faixas de referência comuns em avaliação imobiliária (não são
    // regra da CAIXA confirmada — ajustar quando o critério oficial de
    // aprovação do Fluxo Pareado for esclarecido pelo Gestor Operacional).
    const dentroDe10PorCento = desvios.filter((d) => Math.abs(d.erroPercentual) <= 10).length;
    const dentroDe20PorCento = desvios.filter((d) => Math.abs(d.erroPercentual) <= 20).length;

    return res.status(200).json({
      total_pares: pares.length,
      filtros: { cidade: cidadeFiltro || "todas", periodo_dias: dias || "todos" },
      mape_percentual: Number(mape.toFixed(2)),
      vies_percentual: Number(vies.toFixed(2)),
      vies_interpretacao:
        vies > 1 ? "Modelo tende a SUPERESTIMAR" : vies < -1 ? "Modelo tende a SUBESTIMAR" : "Sem viés sistemático relevante",
      registros_dentro_de_10pct: `${dentroDe10PorCento}/${pares.length} (${((dentroDe10PorCento / pares.length) * 100).toFixed(1)}%)`,
      registros_dentro_de_20pct: `${dentroDe20PorCento}/${pares.length} (${((dentroDe20PorCento / pares.length) * 100).toFixed(1)}%)`,
      maior_desvio_individual: {
        id_registro: maiorDesvio.id,
        desvio_percentual: Number(maiorDesvio.erroPercentual.toFixed(2)),
      },
      aviso: "Critério oficial de aprovação do Fluxo Pareado (faixa de desvio aceitável) deve ser confirmado com o Gestor Operacional da CAIXA — os limiares de 10%/20% acima são referência geral de mercado, não confirmação contratual.",
    });
  } catch (err) {
    console.error("Erro ao calcular estatísticas do Fluxo Pareado:", err);
    return res.status(500).json({ erro: "Erro interno ao calcular estatísticas." });
  }
}
