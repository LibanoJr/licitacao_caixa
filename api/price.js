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

// A integração Vercel Marketplace × Neon pode nomear a variável de formas
// diferentes dependendo do nome do recurso escolhido (ex: "STORAGE_" como
// prefixo). Tenta todas as variações plausíveis, na ordem de preferência
// (pooled primeiro, é o recomendado pra função serverless).
const CONNECTION_STRING =
  process.env.STORAGE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.STORAGE_DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const sql = CONNECTION_STRING ? neon(CONNECTION_STRING) : null;

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
  // Entorno do DF, estado de Goiás — dado bem mais esparso que o DF, sem
  // agregado tipo FipeZAP disponível. Baseado em poucos anúncios
  // individuais (apartamento de entrada ~R$2.300/m², condomínios
  // fechados tipo Damha/Alphaville acima de R$4.000/m²).
  // Confiança BAIXA — validar assim que houver dado de venda real.
  "cidade-ocidental-go": {
    valor_medio_fallback: 3200,
    regioes: {
      "damha": { valor: 4200, fonte: "placeholder_baixa_confianca" },
      "alphaville": { valor: 4200, fonte: "placeholder_baixa_confianca" },
    },
  },
  // Próximas cidades entram aqui como novas chaves.
};

// Padrões de identificação de CIDADE (a partir de comarca_uf). Cada
// cidade nova (escolhida pelo time ou atribuída pela CAIXA) só precisa
// de uma entrada aqui + uma entrada em PRECO_M2_POR_CIDADE.
// Extrai a UF (estado) do texto do comarca_uf, quando disponível — usado
// pra desambiguar nomes de cidade que existem em mais de um estado (ex:
// "Planaltina" existe no DF e em Goiás, como cidades diferentes).
function extrairUF(comarcaUf) {
  const texto = normalizar(comarcaUf);
  if (/\bdf\b/.test(texto) || texto.includes("distrito federal")) return "df";
  if (/\bgo\b/.test(texto) || texto.includes("goias") || texto.includes("goiania")) return "go";
  if (/\bsp\b/.test(texto) || texto.includes("sao paulo")) return "sp";
  if (/\brj\b/.test(texto) || texto.includes("rio de janeiro")) return "rj";
  if (/\bmg\b/.test(texto) || texto.includes("minas gerais")) return "mg";
  return null;
}

// Cada entrada pode exigir uma UF específica (campo "uf") — usado só
// onde existe colisão de nome real. Entradas sem "uf" casam só pelo nome.
// ORDEM IMPORTA: entradas com "uf" que resolvem colisão devem vir ANTES
// do padrão genérico que colide (ex: "planaltina" do DF).
const PADROES_CIDADE = [
  // Colisão conhecida: Planaltina existe como cidade separada em GO E
  // como Região Administrativa do DF. Sem confirmar a UF, não adivinha.
  { padroes: ["planaltina"], uf: "go", cidade: "planaltina-go" },

  { padroes: ["cidade ocidental"], cidade: "cidade-ocidental-go" },
  { padroes: ["luziania"], cidade: "luziania-go" },
  { padroes: ["valparaiso"], cidade: "valparaiso-go" },
  { padroes: ["novo gama"], cidade: "novo-gama-go" },
  { padroes: ["aguas lindas"], cidade: "aguas-lindas-go" },
  { padroes: ["formosa"], cidade: "formosa-go" },
  { padroes: ["anapolis"], cidade: "anapolis-go" },
  { padroes: ["caldas novas"], cidade: "caldas-novas-go" },
  { padroes: ["rio verde"], cidade: "rio-verde-go" },
  { padroes: ["goiatuba"], cidade: "goiatuba-go" },
  { padroes: ["goiania"], cidade: "rm-goiania-go" },

  // SP tem 3 regiões distintas na lista — nomes mais específicos primeiro,
  // "sao paulo" genérico por último (senão captura os outros dois).
  { padroes: ["campinas"], cidade: "rm-campinas-sp" },
  { padroes: ["vale do paraiba", "sao jose dos campos", "taubate"], cidade: "rm-vale-paraiba-sp" },
  { padroes: ["sao paulo"], cidade: "rm-sao-paulo-sp" },

  { padroes: ["rio de janeiro"], cidade: "rm-rio-de-janeiro-rj" },
  { padroes: ["belo horizonte"], cidade: "rm-belo-horizonte-mg" },

  // DF — inclui nomes de circunscrições/RAs conhecidas (nem toda matrícula
  // do DF tem "Brasília" ou "Distrito Federal" literal no comarca_uf; o DF
  // tem múltiplas circunscrições judiciárias). Fica por último porque
  // "planaltina" aqui só deve casar quando a entrada específica de GO
  // acima já foi descartada (UF não era go).
  {
    padroes: [
      "brasilia", "distrito federal", "taguatinga", "ceilandia", "sobradinho",
      "gama", "nucleo bandeirante", "santa maria", "brazlandia", "planaltina",
    ],
    cidade: "brasilia-df",
  },
];

// Padrões de identificação de REGIÃO dentro de cada cidade — cada cidade
// tem sua própria lista, porque a convenção de endereço muda de lugar
// pra lugar (DF usa código de quadra, outras cidades podem usar nome de
// bairro/condomínio direto).
const PADROES_REGIAO_POR_CIDADE = {
  "brasilia-df": [
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
  ],
  "cidade-ocidental-go": [
    { padroes: ["damha"], regiao: "damha" },
    { padroes: ["alphaville"], regiao: "alphaville" },
  ],
  // As demais cidades novas ainda não têm sub-região mapeada — caem no
  // valor médio da cidade (quando configurado) até haver dado de bairro.
};

// Preço de último recurso quando a cidade nem consta em
// PRECO_M2_POR_CIDADE ainda (ex: CAIXA atribuiu uma cidade nova que o
// time ainda não configurou, ou uma das 16 cidades novas que já são
// RECONHECIDAS mas ainda não têm preço validado — ver nota abaixo).
// Propositalmente conservador — sempre marca revisão manual, nunca deve
// ser usado pra fechar um valor "de verdade".
const VALOR_M2_CIDADE_NAO_CONFIGURADA = 5000;

function identificarCidade(comarcaUf) {
  const texto = normalizar(comarcaUf);
  const ufDetectada = extrairUF(comarcaUf);

  for (const { padroes, uf: ufExigida, cidade } of PADROES_CIDADE) {
    const bateNome = padroes.some((p) => texto.includes(p));
    if (!bateNome) continue;
    if (ufExigida && ufDetectada !== ufExigida) continue; // nome bate, mas UF não confirma — evita colisão
    return cidade;
  }
  return null; // cidade não reconhecida — não inventar, sinalizar
}

function identificarRegiao(enderecoCompleto, cidade) {
  const padroesDaCidade = PADROES_REGIAO_POR_CIDADE[cidade];
  if (!padroesDaCidade) return null;
  const texto = normalizar(enderecoCompleto);
  for (const { padroes, regiao } of padroesDaCidade) {
    if (padroes.some((p) => texto.includes(p))) return regiao;
  }
  return null;
}

function obterPrecoM2(dadosExtraidos) {
  const cidade = identificarCidade(dadosExtraidos.comarca_uf);

  if (!cidade || !PRECO_M2_POR_CIDADE[cidade]) {
    // Cidade não configurada ainda — não travamos o cálculo, mas
    // deixamos bem explícito que é um chute de última instância.
    return {
      precoM2: VALOR_M2_CIDADE_NAO_CONFIGURADA,
      fonte: "cidade_nao_configurada",
      regiao: null,
      cidade: cidade || "nao_identificada",
    };
  }

  const tabelaCidade = PRECO_M2_POR_CIDADE[cidade];
  const regiao = identificarRegiao(dadosExtraidos.endereco_completo, cidade);
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
    console.warn("Nenhuma variável de conexão do banco encontrada — pulando gravação de histórico.");
    return;
  }
  try {
    await sql`
      INSERT INTO precificacoes (
        numero_matricula, endereco_completo, cidade_identificada, regiao_identificada,
        area_privativa_m2, area_total_m2, vaga_garagem,
        preco_m2_utilizado, fonte_preco_m2, valor_estimado, fator_ajuste,
        confianca_extracao, imovel_pertence_caixa, onus_ativos, alertas_extracao,
        precisa_revisao_manual, extracao_bruta, precificacao_bruta, tempo_total_ms
      ) VALUES (
        ${dados.numero_matricula || null}, ${dados.endereco_completo || null},
        ${calculo.cidade}, ${calculo.regiao},
        ${parseAreaString(dados.area_privativa_m2)}, ${parseAreaString(dados.area_total_m2)},
        ${dados.vaga_garagem ?? null},
        ${calculo.precoM2}, ${calculo.fonte}, ${respostaFinal.valor_estimado}, ${calculo.ajuste},
        ${dados.confianca_extracao || null}, ${dados.imovel_pertence_caixa ?? null},
        ${JSON.stringify(dados.onus_ativos || [])}, ${JSON.stringify(dados.alertas || [])},
        ${respostaFinal.precisa_revisao_manual},
        ${JSON.stringify(dados)}, ${JSON.stringify(respostaFinal)}, ${calculo.tempoTotalMs}
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

  const inicioPrecificacao = Date.now();

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

    // Tempo de extração vem do CLIENTE (só ele sabe quanto levou a
    // chamada ao /api/extract — o price.js não tem como medir isso
    // sozinho, já que são duas funções serverless separadas). Tempo de
    // precificação é medido aqui mesmo, no servidor, e é sempre confiável.
    const tempoExtracaoMs = Number.isFinite(Number(dados._tempo_extracao_ms))
      ? Number(dados._tempo_extracao_ms)
      : null;
    const tempoPrecificacaoMs = Date.now() - inicioPrecificacao;
    const tempoTotalMs = tempoExtracaoMs !== null ? tempoExtracaoMs + tempoPrecificacaoMs : null;
    const LIMITE_SLA_MS = 5 * 60 * 1000; // 5 minutos — item 9.5 do Anexo I

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
      tempo_processamento: {
        extracao_ms: tempoExtracaoMs,
        precificacao_ms: tempoPrecificacaoMs,
        total_ms: tempoTotalMs,
        dentro_do_sla_5min: tempoTotalMs !== null ? tempoTotalMs <= LIMITE_SLA_MS : null,
      },
      precisa_revisao_manual: precisaRevisaoManual,
      timestamp: new Date().toISOString(),
    };

    // Grava histórico ANTES de responder, mas sem deixar isso travar a
    // resposta em caso de erro no banco.
    await gravarHistorico(dados, { precoM2, fonte, regiao, cidade, ajuste, tempoTotalMs }, respostaFinal);

    return res.status(200).json(respostaFinal);
  } catch (err) {
    console.error("Erro ao calcular precificação:", err);
    return res.status(500).json({ erro: "Erro interno ao calcular precificação." });
  }
}
