// api/historico.js
// Lista os registros de precificação salvos — pra revisar/validar o
// modelo enquanto ele ainda usa a tabela fixa.
//
// GET /api/historico                    → últimos 50 registros
// GET /api/historico?limite=100          → controla quantidade (máx 200)
// GET /api/historico?revisao=true        → só os marcados precisa_revisao_manual

import { neon } from "@neondatabase/serverless";

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido. Use GET." });
  }

  if (!sql) {
    return res.status(500).json({ erro: "DATABASE_URL não configurada no servidor." });
  }

  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
    const somenteRevisao = req.query.revisao === "true";

    const registros = somenteRevisao
      ? await sql`
          SELECT id, criado_em, numero_matricula, endereco_completo,
                 cidade_identificada, regiao_identificada, valor_estimado,
                 confianca_extracao, precisa_revisao_manual
          FROM precificacoes
          WHERE precisa_revisao_manual = true
          ORDER BY criado_em DESC
          LIMIT ${limite}
        `
      : await sql`
          SELECT id, criado_em, numero_matricula, endereco_completo,
                 cidade_identificada, regiao_identificada, valor_estimado,
                 confianca_extracao, precisa_revisao_manual
          FROM precificacoes
          ORDER BY criado_em DESC
          LIMIT ${limite}
        `;

    return res.status(200).json({
      total_retornado: registros.length,
      filtro_aplicado: somenteRevisao ? "apenas_precisa_revisao" : "todos",
      registros,
    });
  } catch (err) {
    console.error("Erro ao consultar histórico:", err);
    return res.status(500).json({ erro: "Erro ao consultar histórico." });
  }
}