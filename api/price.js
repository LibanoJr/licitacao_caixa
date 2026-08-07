// api/price.js
// Endpoint de precificação MVP — Edital CR 12/2026 CAIXA (GEHPA)
//
// Recebe o JSON já extraído (pelo api/extract.js) com os dados do imóvel
// e calcula um valor estimado com base em preço médio de m² por Região
// Administrativa do DF.
//
// ⚠️ IMPORTANTE — LEIA ANTES DE USAR EM PRODUÇÃO:
// Os valores em PRECO_M2_REGIAO são um MVP inicial. Boa parte vem de
// estimativas de terceiros (blogs de mercado citando FipeZap) ou são
// placeholders sem fonte confirmada — o índice FipeZap oficial NÃO
// publica preço por bairro, só agregado por cidade.
// Antes de usar isso pra precificar de verdade, validar com a Planta de
// Valores oficial da Secretaria de Economia do DF ou dados reais de
// transação (ITBI). Ver campo "fonte_preco_m2" e "precisa_revisao_manual"
// no retorno — isso existe justamente pra sinalizar o que ainda não foi
// validado.

const PRECO_M2_REGIAO = {
  "lago sul": { valor: 12500, fonte: "estimativa_terceiro" },
  "setor sudoeste": { valor: 12000, fonte: "estimativa_terceiro" },
  "sudoeste": { valor: 12000, fonte: "estimativa_terceiro" },
  "asa sul": { valor: 9114, fonte: "estimativa_terceiro" },
  "asa norte": { valor: 9000, fonte: "placeholder" },
  "aguas claras": { valor: 8545, fonte: "estimativa_terceiro" },
  "lago norte": { valor: 8500, fonte: "placeholder" },
  "guara": { valor: 6253, fonte: "estimativa_terceiro" },
  "vicente pires": { valor: 6500, fonte: "placeholder" },
  "taguatinga": { valor: 5500, fonte: "placeholder" },
  "sobradinho": { valor: 4500, fonte: "placeholder" },
  "gama": { valor: 4200, fonte: "placeholder" },
  "samambaia": { valor: 4000, fonte: "placeholder" },
  "ceilandia": { valor: 3800, fonte: "placeholder" },
  "recanto das emas": { valor: 3800, fonte: "placeholder" },
  "planaltina": { valor: 3500, fonte: "placeholder" },
};

const VALOR_M2_PADRAO = 6000; // fallback se a região não for reconhecida
const FONTE_PADRAO = "fallback_medio_df";

// Remove acentos e normaliza caixa/espaços pra bater com as chaves do dicionário
function normalizarRegiao(texto) {
  if (!texto) return "";
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Ajustes simples por características do imóvel (regra de mercado, não regressão)
function calcularAjuste(dados) {
  let ajuste = 1.0;
  const detalhes = [];

  const vagas = Number(dados.vagas_garagem);
  const quartos = Number(dados.quartos);
  const idade = Number(dados.idade_imovel);

  if (vagas >= 2) {
    ajuste *= 1.05;
    detalhes.push("+5% (2+ vagas de garagem)");
  }
  if (quartos >= 3) {
    ajuste *= 1.03;
    detalhes.push("+3% (3+ quartos)");
  }
  if (idade && idade > 30) {
    ajuste *= 0.95;
    detalhes.push("-5% (imóvel com mais de 30 anos)");
  }

  return { ajuste, detalhes };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido. Use POST." });
  }

  try {
    const dados = req.body;

    // Campos esperados no JSON de entrada (ajustar os nomes abaixo se o
    // extract.js usar chaves diferentes — me manda o JSON de saída real
    // do extract.js que eu alinho isso certinho):
    //   area_privativa          (número, em m²)  -- obrigatório
    //   regiao_administrativa   (string)         -- ou "bairro" / "municipio"
    //   vagas_garagem           (número, opcional)
    //   quartos                 (número, opcional)
    //   idade_imovel            (número, opcional)
    //   confianca_extracao      (número 0-1, opcional — vindo do extract.js)

    const area = Number(dados.area_privativa);
    if (!area || area <= 0) {
      return res.status(400).json({
        erro: "area_privativa ausente ou inválida",
        campo_esperado: "area_privativa (número, em m²)",
      });
    }

    const regiaoBruta =
      dados.regiao_administrativa || dados.bairro || dados.municipio || "";
    const regiaoNormalizada = normalizarRegiao(regiaoBruta);

    const infoRegiao = PRECO_M2_REGIAO[regiaoNormalizada];
    const precoM2 = infoRegiao ? infoRegiao.valor : VALOR_M2_PADRAO;
    const fontePrecoM2 = infoRegiao ? infoRegiao.fonte : FONTE_PADRAO;

    const valorBase = area * precoM2;
    const { ajuste, detalhes } = calcularAjuste(dados);
    const valorEstimado = Math.round(valorBase * ajuste);

    const precisaRevisaoManual =
      fontePrecoM2 === "placeholder" ||
      fontePrecoM2 === "fallback_medio_df" ||
      (typeof dados.confianca_extracao === "number" &&
        dados.confianca_extracao < 0.7);

    return res.status(200).json({
      valor_estimado: valorEstimado,
      moeda: "BRL",
      detalhes_calculo: {
        area_privativa: area,
        regiao_identificada: regiaoBruta,
        regiao_normalizada: regiaoNormalizada,
        preco_m2_utilizado: precoM2,
        fonte_preco_m2: fontePrecoM2,
        valor_base: Math.round(valorBase),
        fator_ajuste: ajuste,
        ajustes_aplicados: detalhes,
      },
      precisa_revisao_manual: precisaRevisaoManual,
      aviso:
        fontePrecoM2 !== "estimativa_terceiro"
          ? "Preço de m² baseado em placeholder/fallback — validar antes de uso oficial."
          : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Erro ao calcular precificação:", err);
    return res.status(500).json({ erro: "Erro interno ao calcular precificação." });
  }
}
