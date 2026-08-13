// api/registrar-avaliacao.js
// Fluxo Pareado (item 19.10 do Anexo I) — registra o valor de uma
// avaliação profissional (NBR 14653) contra um registro de precificação
// automática já existente, pra permitir a comparação estatística.
//
// POST /api/registrar-avaliacao
// Body: { id: <id do registro em precificacoes>, valor_real_avaliado: <número>, fonte_valor_real: <texto opcional> }

import { neon } from "@neondatabase/serverless";

const CONNECTION_STRING =
  process.env.STORAGE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.STORAGE_DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const sql = CONNECTION_STRING ? neon(CONNECTION_STRING) : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido. Use POST." });
  }

  if (!sql) {
    return res.status(500).json({ erro: "Variável de conexão do banco não configurada no servidor." });
  }

  try {
    const { id, valor_real_avaliado, fonte_valor_real } = req.body || {};

    const idNumerico = Number(id);
    if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ erro: "Campo 'id' ausente ou inválido — deve ser o id do registro em /api/historico." });
    }

    const valor = Number(valor_real_avaliado);
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: "Campo 'valor_real_avaliado' ausente ou inválido." });
    }

    const fonte = fonte_valor_real ? String(fonte_valor_real).slice(0, 200) : "NBR14653_fluxo_pareado";

    const resultado = await sql`
      UPDATE precificacoes
      SET valor_real_avaliado = ${valor},
          fonte_valor_real = ${fonte}
      WHERE id = ${idNumerico}
      RETURNING id, valor_estimado, valor_real_avaliado, fonte_valor_real
    `;

    if (resultado.length === 0) {
      return res.status(404).json({ erro: `Nenhum registro encontrado com id ${idNumerico}.` });
    }

    const registro = resultado[0];
    const desvioPercentual = registro.valor_estimado
      ? ((registro.valor_estimado - registro.valor_real_avaliado) / registro.valor_real_avaliado) * 100
      : null;

    return res.status(200).json({
      registro_atualizado: registro,
      desvio_percentual: desvioPercentual !== null ? Number(desvioPercentual.toFixed(2)) : null,
      interpretacao:
        desvioPercentual === null
          ? null
          : desvioPercentual > 0
          ? `Modelo superestimou em ${Math.abs(desvioPercentual).toFixed(2)}%`
          : `Modelo subestimou em ${Math.abs(desvioPercentual).toFixed(2)}%`,
    });
  } catch (err) {
    console.error("Erro ao registrar avaliação real:", err);
    return res.status(500).json({ erro: "Erro interno ao registrar avaliação." });
  }
}
