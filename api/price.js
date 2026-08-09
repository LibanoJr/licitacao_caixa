// api/price.js
// Endpoint de precificação — Edital CR 12/2026 CAIXA (GEHPA)
//
// Recebe DIRETO o JSON que o api/extract.js devolve, calcula um valor
// estimado, e grava um registro de auditoria no banco (Neon Postgres,
// plano gratuito). Se o banco falhar, a precificação NÃO quebra — só loga
// o erro. Gravar histórico é importante, mas nunca pode ser a razão de
// derrubar a resposta pro usuário.
//
// ⚠️ LEIA ANTES DE USAR EM PRODUÇÃO:
// 1) obterPrecoM2() é a peça DESCARTÁVEL deste arquivo — tabela fixa hoje,
//    vira chamada a modelo treinado quando a base de dados de treino
//    chegar. O contrato (recebe dados extraídos, devolve preço) não muda.
// 2) Região é inferida do endereço por palavras-chave (convenção de
//    quadras do DF) — best-effort, marca revisão manual quando não
//    reconhece.
// 3) "quartos"/"idade_imovel" não existem no schema do extract.js — só
//    entram no ajuste se vierem manualmente.

import { neon } from "@neondatabase/serverless";

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

// ============================================================
// MOTOR DE PRECIFICAÇÃO — parte que será substituída pelo modelo treinado
// ============================================================

const PRECO_M2_POR_CIDADE = {
  "brasilia-df": {
    valor_medio_fallback: 6000,
    regioes: {
      "setor sudoeste": { valor: 12000, fonte: "estimativa_terceiro" },
      "noroeste": { valor: 11500, fonte: "placeholder" },
      "lago sul": { valor: 12500, fonte: "estimativa_terceiro" },
      "lago norte": { valor: 8500, fonte: "placeholder" },
      "asa sul": { valor: 9114, fonte: "estimativa_terceiro" },
      "asa norte": { valor: 9000, fonte: "placeholder" },
      "aguas claras": { valor: 8545, fonte: "estimativa_terceiro" },
      "vicente pires": { valor: 6500, fonte: "placeholder" },
      "guara": { valor: 6253, fonte: "estimativa_terceiro" },
      "taguatinga": { valor: 5500, fonte: "placeholder" },
      "sobradinho": { valor: 4500, fonte: "placeholder" },
      "gama": { valor: 4200, fonte: "placeholder" },
      "samambaia": { valor: 4000, fonte: "placeholder" },
      "ceilandia": { valor: 3800, fonte: "placeholder" },
      "recanto das emas": { valor: 3800, fonte: "placeholder" },
      "planaltina": { valor: 3500, fonte: "placeholder" },
    },
  },
};

const PADROES_REGIAO_DF = [
  { padroes: ["sqsw", "sudoeste"], regiao: "setor sudoeste" },
  { padroes: ["sqnw", "noroeste"], regiao: "noroeste" },
  { padroes: ["shis", "lago sul"], regiao: "lago sul" },
  { padroes: ["shin", "lago norte"], regiao: "lago norte" },
  { padroes: ["sqs", "asa sul"], regiao: "asa sul" },
  { padroes: ["sqn", "asa norte"], regiao: "asa norte" },
  { padroes: ["aguas claras"], regiao: "aguas claras" },
  { padroes: ["vicente pires"], regiao: "vicente pires" },
  { padroes: ["taguatinga"], regiao: "taguatinga" },
  { padroes: ["ceilandia"], regiao: "ceilandia" },
  { padroes: ["samambaia"], regiao: "samambaia" },
  { padroes: ["guara"], regiao: "guara" },
  { padroes: ["recanto das emas"], regiao: "recanto das emas" },
  { padroes: ["gama"], regiao: "gama" },
  { padroes: ["sobradinho"], regiao: "sobradinho" },
  { padroes: ["planaltina"], regiao: "planaltina" },
];

function identificarCidade(comarcaUf) {
  const texto = normalizar(comarcaUf);
  if (texto.includes("brasilia") || texto.includes("df")) return "brasilia-df";
  return "brasilia-df";
}

function identificarRegiao(enderecoCompleto, tabelaRegioes) {
  const texto = normalizar(enderecoCompleto);
  for (const { padroes, regiao } of PADROES_REGIAO_DF) {
    if (padroes.some((p) => texto.includes(p)) && tabelaRegioes[regiao]) {
      return regiao;
    }
  }
  return null;
}

function obterPrecoM2(dadosExtraidos) {
  const cidade = identificarCidade(dadosExtraidos.comarca_uf);
  const tabelaCidade = PRECO_M2_POR_CIDADE[cidade];
  const regiao = identificarRegiao(dadosExtraidos.endereco_completo, tabelaCidade.regioes);
  const infoRegiao = regiao ? tabelaCidade.regioes[regiao] : null;

  return {
    precoM2: infoRegiao ? infoRegiao.valor : tabelaCidade.valor_medio_fallback,
    fonte: infoRegiao ? infoRegiao.fonte : "fallback_medio_cidade",
    regiao,
    cidade,
  };
}

// ============================================================
// CAMADA ESTÁVEL — parsing, validação, resposta, auditoria
// ============================================================

function normalizar(texto) {
  if (!texto) return "";
  return texto
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Trata os dois formatos possíveis: brasileiro (vírgula decimal, ponto
// milhar — ex: "40.002,50") e internacional/JSON (ponto decimal — ex:
// "80.5"). O extract.js não força uma convenção específica nesses campos,
// então os dois formatos são esperados na prática.
function parseAreaString(valor) {
  if (valor === null || valor === undefined) return null;
  let texto = valor.toString().replace(/m²|m2/gi, "").trim();
  if (!texto) return null;

  const temVirgula = texto.includes(",");
  const qtdPontos = (texto.match(/\./g) || []).length;

  if (temVirgula) {
    // Formato brasileiro: ponto é separador de milhar, vírgula é decimal
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (qtdPontos > 1) {
    // Mais de um ponto só faz sentido como separador de milhar
    // (ex: "1.234.567") — não tem convenção com múltiplos pontos decimais
    texto = texto.replace(/\./g, "");
  }
  // Um único ponto sem vírgula (ex: "80.5") é tratado como decimal —
  // mais seguro do que assumir milhar, que exigiria área implausível.

  const num = parseFloat(texto);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function calcularAjuste(dados) {
  let ajuste = 1.0;
  const detalhes = [];

  if (dados.vaga_garagem === true) {
    ajuste *= 1.03;
    detalhes.push("+3% (possui vaga de garagem)");
  }
  const quartos = Number(dados.quartos);
  if (quartos >= 3) {
    ajuste *= 1.03;
    detalhes.push("+3% (3+ quartos — informado manualmente)");
  }
  const idade = Number(dados.idade_imovel);
  if (idade && idade > 30) {
    ajuste *= 0.95;
    detalhes.push("-5% (imóvel com mais de 30 anos — informado manualmente)");
  }

  return { ajuste, detalhes };
}

function confiancaExigeRevisao(confiancaExtracao) {
  return confiancaExtracao !== "alta";
}

// Grava o registro de auditoria. NUNCA deixa uma falha aqui derrubar a
// resposta principal — só loga o erro no console da Vercel.
async function gravarHistorico(dados, calculo, respostaFinal) {
  if (!sql) {
    console.warn("DATABASE_URL não configurada — pulando gravação de histórico.");
    return;
  }
  try {
    await sql`
      INSERT INTO precificacoes (
        numero_matricula, endereco_completo, cidade_identificada, regiao_identificada,
        area_privativa_m2, area_total_m2, vaga_garagem,
        preco_m2_utilizado, fonte_preco_m2, valor_estimado, fator_ajuste,
        confianca_extracao, imovel_pertence_caixa, onus_ativos, alertas_extracao,
        precisa_revisao_manual, extracao_bruta, precificacao_bruta
      ) VALUES (
        ${dados.numero_matricula || null}, ${dados.endereco_completo || null},
        ${calculo.cidade}, ${calculo.regiao},
        ${parseAreaString(dados.area_privativa_m2)}, ${parseAreaString(dados.area_total_m2)},
        ${dados.vaga_garagem ?? null},
        ${calculo.precoM2}, ${calculo.fonte}, ${respostaFinal.valor_estimado}, ${calculo.ajuste},
        ${dados.confianca_extracao || null}, ${dados.imovel_pertence_caixa ?? null},
        ${JSON.stringify(dados.onus_ativos || [])}, ${JSON.stringify(dados.alertas || [])},
        ${respostaFinal.precisa_revisao_manual},
        ${JSON.stringify(dados)}, ${JSON.stringify(respostaFinal)}
      )
    `;
  } catch (dbErr) {
    console.error("Falha ao gravar histórico (não afeta a resposta):", dbErr.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido. Use POST." });
  }

  try {
    const dados = req.body;

    if (!dados || typeof dados !== "object") {
      return res.status(400).json({ erro: "Corpo da requisição ausente ou inválido." });
    }

    const areaPrivativa = parseAreaString(dados.area_privativa_m2);
    const areaTotal = parseAreaString(dados.area_total_m2);
    const area = areaPrivativa || areaTotal;
    const origemArea = areaPrivativa
      ? "area_privativa_m2"
      : areaTotal
      ? "area_total_m2 (privativa ausente)"
      : null;

    if (!area) {
      return res.status(400).json({
        erro: "Não foi possível determinar a área do imóvel.",
        detalhe: "area_privativa_m2 e area_total_m2 vieram ambos nulos/inválidos no JSON extraído.",
      });
    }

    const { precoM2, fonte, regiao, cidade } = obterPrecoM2(dados);
    const valorBase = area * precoM2;
    const { ajuste, detalhes } = calcularAjuste(dados);
    const valorEstimado = Math.round(valorBase * ajuste);

    const precisaRevisaoManual =
      !regiao ||
      fonte !== "estimativa_terceiro" ||
      confiancaExigeRevisao(dados.confianca_extracao) ||
      dados.imovel_pertence_caixa === null ||
      dados.imovel_pertence_caixa === undefined;

    const respostaFinal = {
      valor_estimado: valorEstimado,
      moeda: "BRL",
      detalhes_calculo: {
        area_utilizada_m2: area,
        origem_area: origemArea,
        cidade_identificada: cidade,
        endereco_original: dados.endereco_completo || null,
        regiao_identificada: regiao || "não reconhecida (endereço não bateu com padrões conhecidos)",
        preco_m2_utilizado: precoM2,
        fonte_preco_m2: fonte,
        valor_base: Math.round(valorBase),
        fator_ajuste: ajuste,
        ajustes_aplicados: detalhes,
      },
      contexto_extracao: {
        confianca_extracao: dados.confianca_extracao || null,
        imovel_pertence_caixa: dados.imovel_pertence_caixa ?? null,
        onus_ativos: dados.onus_ativos || [],
        alertas_extracao: dados.alertas || [],
      },
      precisa_revisao_manual: precisaRevisaoManual,
      timestamp: new Date().toISOString(),
    };

    // Grava histórico ANTES de responder, mas sem deixar isso travar a
    // resposta em caso de erro no banco.
    await gravarHistorico(dados, { precoM2, fonte, regiao, cidade, ajuste }, respostaFinal);

    return res.status(200).json(respostaFinal);
  } catch (err) {
    console.error("Erro ao calcular precificação:", err);
    return res.status(500).json({ erro: "Erro interno ao calcular precificação." });
  }
}