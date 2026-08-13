// api/historico.js
// Lista os registros de precificação salvos — pra revisar/validar o
// modelo enquanto ele ainda usa a tabela fixa.
//
// GET /api/historico                          → últimos 50 registros
// GET /api/historico?limite=100                → controla quantidade (máx 200)
// GET /api/historico?revisao=true              → só os marcados precisa_revisao_manual
// GET /api/historico?cidade=cidade-ocidental-go → só registros dessa cidade
// (os filtros acima podem ser combinados, ex: ?cidade=...&revisao=true)

import { neon } from "@neondatabase/serverless";

// Mesma lógica de fallback do price.js — a Vercel pode ter nomeado a
// variável com prefixo "STORAGE_" dependendo do nome do recurso.
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
    const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
    const cidadeFiltro = req.query.cidade ? String(req.query.cidade).toLowerCase().trim() : null;
    const revisaoFiltro = req.query.revisao === "true" ? true : null; // null = sem filtro

    // Cast explícito (::text / ::boolean) + "IS NULL OR" é o padrão do
    // Postgres pra filtro opcional numa query só, sem precisar montar
    // SQL dinamicamente na mão (mais seguro contra erro de digitação).
    const registros = await sql`
      SELECT id, criado_em, numero_matricula, endereco_completo,
             cidade_identificada, regiao_identificada, valor_estimado,
             confianca_extracao, precisa_revisao_manual
      FROM precificacoes
      WHERE (${cidadeFiltro}::text IS NULL OR cidade_identificada = ${cidadeFiltro})
        AND (${revisaoFiltro}::boolean IS NULL OR precisa_revisao_manual = ${revisaoFiltro})
      ORDER BY criado_em DESC
      LIMIT ${limite}
    `;

    return res.status(200).json({
      total_retornado: registros.length,
      filtros_aplicados: {
        cidade: cidadeFiltro || "todas",
        revisao: revisaoFiltro === null ? "todos" : "apenas_precisa_revisao",
      },
      registros,
    });
  } catch (err) {
    console.error("Erro ao consultar histórico:", err);
    return res.status(500).json({ erro: "Erro ao consultar histórico." });
  }
}
