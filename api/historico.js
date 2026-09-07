// api/historico.js
// Lista os registros de precificação salvos — pra revisar/validar o
// modelo enquanto ele ainda usa a tabela fixa.
//
// GET /api/historico                          → últimos 50 registros
// GET /api/historico?limite=100                → controla quantidade (máx 200)
// GET /api/historico?revisao=true              → só os marcados precisa_revisao_manual
// GET /api/historico?cidade=cidade-ocidental-go → só registros dessa cidade
// GET /api/historico?formato=csv               → exporta em CSV em vez de JSON (item 2.3 do Anexo I)
// (todos os filtros acima podem ser combinados)

import { neon } from "@neondatabase/serverless";

const CONNECTION_STRING =
  process.env.STORAGE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.STORAGE_DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const sql = CONNECTION_STRING ? neon(CONNECTION_STRING) : null;

// Converte um array de objetos (linhas do banco) em texto CSV, com
// escape correto de vírgula/aspas/quebra de linha dentro de campos de
// texto livre (ex: endereco_completo pode conter vírgula).
function paraCSV(registros) {
  if (registros.length === 0) return "";
  const colunas = Object.keys(registros[0]);

  const escapar = (valor) => {
    if (valor === null || valor === undefined) return "";
    const texto = String(valor);
    if (/[",\n]/.test(texto)) {
      return '"' + texto.replace(/"/g, '""') + '"';
    }
    return texto;
  };

  const linhas = [colunas.join(",")];
  for (const registro of registros) {
    linhas.push(colunas.map((c) => escapar(registro[c])).join(","));
  }
  return linhas.join("\n");
}

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
    const formatoCsv = req.query.formato === "csv";

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

    if (formatoCsv) {
      const csv = paraCSV(registros);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="historico_precificacoes.csv"`);
      return res.status(200).send(csv);
    }

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