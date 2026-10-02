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
// METADADOS DO MODELO — item 20.14 do Anexo I (controle de versão) e
// itens 2.2.iii / 17.6 (indicação de responsável pela modelagem e pela
// precificação em cada resultado entregue)
// ============================================================

// Atualizar VERSAO e DATA_ATUALIZACAO sempre que a metodologia mudar de
// verdade (troca de tabela de preço, mudança de fórmula de ajuste, ou —
// no futuro — troca da tabela fixa pelo modelo estatístico treinado).
// Isso é o que possibilita rastrear qual versão gerou qual precificação,
// exigência explícita do item 20.14 ("controle de versão e de vigência").
const METADADOS_MODELO = {
  versao: "1.1.1-baseline",
  tipo_modelo: "baseline_deterministico_referencia_regional",
  data_atualizacao: "2026-10-02",
  descricao: "Tabela de referência de preço/m² por região + ajustes percentuais fixos. Não é modelo estatístico treinado (ver Relatório do Modelo, Seção 3.1).",
  historico_versoes: [
    { versao: "1.0.0-baseline", data: "2026-08-24", mudanca: "Versão inicial: tabela DF + Cidade Ocidental/GO." },
    { versao: "1.1.0-baseline", data: "2026-10-02", mudanca: "São Paulo/SP (capital) com preço/m² por bairro; correção de leitura de área com separador de milhar; motivos de revisão explícitos." },
    { versao: "1.1.1-baseline", data: "2026-10-02", mudanca: "Definição explícita de cada tipo de área na extração; área construída para casas; área do terreno nunca usada como base." },
  ],
};

// RT pela Modelagem (item 4.3) e RT pela Precificação/Emissão (item 4.9)
// — preencher os nomes reais assim que confirmados pelo time. Aparecer
// em todo resultado é exigência dos itens 2.2.iii e 17.6, não é opcional.
// Nomes e registros profissionais vêm de variáveis de ambiente na Vercel,
// pra poder preencher/trocar sem mexer no código. Se não configurados,
// aparecem como "PENDENTE" (nunca como null silencioso) — assim fica
// visível no relatório que a exigência ainda não foi cumprida.
function rt(nomeEnv, registroEnv, nomePadrao, funcao) {
  return {
    nome: process.env[nomeEnv] || nomePadrao || "PENDENTE — configurar " + nomeEnv,
    registro_profissional: process.env[registroEnv] || null,
    funcao,
  };
}

const RESPONSAVEIS_TECNICOS = {
  modelagem: rt("RT_MODELAGEM_NOME", "RT_MODELAGEM_REGISTRO", "Líbano Abboud Júnior",
    "RT pelo Modelo de Precificação Automatizada (Ciência de Dados)"),
  analise_mercado_imobiliario: rt("RT_ANALISE_NOME", "RT_ANALISE_REGISTRO", null,
    "RT pela Análise das Precificações de Imóveis (Mercado Imobiliário)"),
  emissao_relatorio: rt("RT_EMISSAO_NOME", "RT_EMISSAO_REGISTRO", null,
    "RT pela Emissão do Relatório de Precificação"),
};

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
  // São Paulo/SP — CAPITAL (cidade designada pela CAIXA em 07/09/2026
  // para o Fluxo Pareado). Valores = mediana do preço PEDIDO por m² de
  // APARTAMENTOS à venda, por bairro, edição outubro/2026 de "A Corrida
  // dos Bairros" (acorridadosbairros.com.br/sp/sao-paulo/apartamentos/),
  // 45.870 anúncios. "n" = nº de anúncios do bairro; abaixo de 20 o
  // resultado vai pra revisão manual. São preços de OFERTA, não de
  // transação — não há fator de oferta aplicado nesta versão (ver
  // Relatório do Modelo). Atualizar mensalmente (a fonte atualiza dia 1).
  "sao-paulo-sp-capital": {
    valor_medio_fallback: 9475, // mediana da cidade, out/2026
    fonte_fallback: "mediana_cidade_anuncios_out2026",
    regioes: {
      "vila nova conceicao": { valor: 25397, n: 295, fonte: "mediana_anuncios_bairro" },
      "jardim europa": { valor: 22840, n: 60, fonte: "mediana_anuncios_bairro" },
      "jardim america": { valor: 20408, n: 169, fonte: "mediana_anuncios_bairro" },
      "jardim paulistano": { valor: 19780, n: 47, fonte: "mediana_anuncios_bairro" },
      "itaim bibi": { valor: 18919, n: 978, fonte: "mediana_anuncios_bairro" },
      "cerqueira cesar": { valor: 18558, n: 286, fonte: "mediana_anuncios_bairro" },
      "alto de pinheiros": { valor: 17715, n: 117, fonte: "mediana_anuncios_bairro" },
      "jardim das perdizes": { valor: 17610, n: 48, fonte: "mediana_anuncios_bairro" },
      "vila olimpia": { valor: 17143, n: 815, fonte: "mediana_anuncios_bairro" },
      "moema": { valor: 16552, n: 729, fonte: "mediana_anuncios_bairro" },
      "vila madalena": { valor: 16050, n: 412, fonte: "mediana_anuncios_bairro" },
      "pinheiros": { valor: 15916, n: 1002, fonte: "mediana_anuncios_bairro" },
      "jardim paulista": { valor: 15250, n: 744, fonte: "mediana_anuncios_bairro" },
      "brooklin": { valor: 14815, n: 1013, fonte: "mediana_anuncios_bairro" },
      "chacara klabin": { valor: 14408, n: 210, fonte: "mediana_anuncios_bairro" },
      "vila leopoldina": { valor: 14009, n: 77, fonte: "mediana_anuncios_bairro" },
      "alto da lapa": { valor: 13078, n: 110, fonte: "mediana_anuncios_bairro" },
      "vila clementino": { valor: 13081, n: 490, fonte: "mediana_anuncios_bairro" },
      "vila mariana": { valor: 12924, n: 1170, fonte: "mediana_anuncios_bairro" },
      "pompeia": { valor: 12868, n: 146, fonte: "mediana_anuncios_bairro" },
      "agua branca": { valor: 12750, n: 139, fonte: "mediana_anuncios_bairro" },
      "higienopolis": { valor: 12747, n: 458, fonte: "mediana_anuncios_bairro" },
      "campo belo": { valor: 12615, n: 1121, fonte: "mediana_anuncios_bairro" },
      "perdizes": { valor: 12391, n: 1094, fonte: "mediana_anuncios_bairro" },
      "barra funda": { valor: 11870, n: 171, fonte: "mediana_anuncios_bairro" },
      "consolacao": { valor: 11411, n: 886, fonte: "mediana_anuncios_bairro" },
      "santo amaro": { valor: 10893, n: 269, fonte: "mediana_anuncios_bairro" },
      "lapa": { valor: 10857, n: 89, fonte: "mediana_anuncios_bairro" },
      "analia franco": { valor: 10850, n: 1015, fonte: "mediana_anuncios_bairro" },
      "tatuape": { valor: 10741, n: 801, fonte: "mediana_anuncios_bairro" },
      "santa cecilia": { valor: 10525, n: 270, fonte: "mediana_anuncios_bairro" },
      "pacaembu": { valor: 10136, n: 40, fonte: "mediana_anuncios_bairro" },
      "ipiranga": { valor: 10105, n: 843, fonte: "mediana_anuncios_bairro" },
      "vila maria": { valor: 10080, n: 42, fonte: "mediana_anuncios_bairro" },
      "belenzinho": { valor: 10000, n: 121, fonte: "mediana_anuncios_bairro" },
      "saude": { valor: 9868, n: 320, fonte: "mediana_anuncios_bairro" },
      "butanta": { valor: 9576, n: 350, fonte: "mediana_anuncios_bairro" },
      "casa verde": { valor: 9561, n: 54, fonte: "mediana_anuncios_bairro" },
      "santana": { valor: 9536, n: 483, fonte: "mediana_anuncios_bairro" },
      "aclimacao": { valor: 9384, n: 944, fonte: "mediana_anuncios_bairro" },
      "mooca": { valor: 9355, n: 499, fonte: "mediana_anuncios_bairro" },
      "tucuruvi": { valor: 8805, n: 172, fonte: "mediana_anuncios_bairro" },
      "vila guilherme": { valor: 8774, n: 118, fonte: "mediana_anuncios_bairro" },
      "vila prudente": { valor: 8696, n: 245, fonte: "mediana_anuncios_bairro" },
      "vila sonia": { valor: 8589, n: 80, fonte: "mediana_anuncios_bairro" },
      "interlagos": { valor: 8571, n: 36, fonte: "mediana_anuncios_bairro" },
      "vila carrao": { valor: 8520, n: 268, fonte: "mediana_anuncios_bairro" },
      "jaguare": { valor: 8308, n: 153, fonte: "mediana_anuncios_bairro" },
      "vila formosa": { valor: 8258, n: 268, fonte: "mediana_anuncios_bairro" },
      "morumbi": { valor: 8182, n: 309, fonte: "mediana_anuncios_bairro" },
      "freguesia do o": { valor: 8000, n: 71, fonte: "mediana_anuncios_bairro" },
      "vila matilde": { valor: 7763, n: 91, fonte: "mediana_anuncios_bairro" },
      "cambuci": { valor: 7741, n: 268, fonte: "mediana_anuncios_bairro" },
      "vila andrade": { valor: 7579, n: 358, fonte: "mediana_anuncios_bairro" },
      "sapopemba": { valor: 7499, n: 12, fonte: "mediana_anuncios_bairro" },
      "jabaquara": { valor: 7421, n: 148, fonte: "mediana_anuncios_bairro" },
      "cidade ademar": { valor: 7419, n: 21, fonte: "mediana_anuncios_bairro" },
      "mandaqui": { valor: 7271, n: 124, fonte: "mediana_anuncios_bairro" },
      "itaquera": { valor: 5958, n: 104, fonte: "mediana_anuncios_bairro" },
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

// Detecta QUALQUER UF do Brasil — usado só pra escolher o motivo certo de
// recusa quando a cidade não está na tabela. Separado de extrairUF() de
// propósito: aquela resolve colisões de nome e não pode mudar de
// comportamento. Aqui, a sigla só vale no FIM do texto ("Curitiba/PR",
// "Foro Central - PR"), porque siglas como SE, AL, PA e ES também são
// palavras comuns. Nomes de estado valem em qualquer posição (exceto
// "Pará", que é a preposição "para" sem acento).
const SIGLAS_UF = ["ac","al","ap","am","ba","ce","df","es","go","ma","mt","ms","mg","pa","pb","pr","pe","pi","rj","rn","rs","ro","rr","sc","sp","se","to"];
const NOMES_UF = [
  ["mato grosso do sul", "ms"], ["mato grosso", "mt"], ["rio grande do norte", "rn"],
  ["rio grande do sul", "rs"], ["rio de janeiro", "rj"], ["espirito santo", "es"],
  ["santa catarina", "sc"], ["distrito federal", "df"], ["minas gerais", "mg"],
  ["sao paulo", "sp"], ["parana", "pr"], ["paraiba", "pb"], ["pernambuco", "pe"],
  ["alagoas", "al"], ["sergipe", "se"], ["bahia", "ba"], ["ceara", "ce"], ["piaui", "pi"],
  ["maranhao", "ma"], ["tocantins", "to"], ["amazonas", "am"], ["amapa", "ap"],
  ["roraima", "rr"], ["rondonia", "ro"], ["goias", "go"], ["acre", "ac"],
];

function detectarQualquerUF(comarcaUf) {
  const texto = normalizar(comarcaUf);
  if (!texto) return null;
  const fim = texto.match(/(?:^|[\s\/\-(,.])([a-z]{2})\)?\s*$/);
  if (fim && SIGLAS_UF.includes(fim[1])) return fim[1];
  for (const [nome, uf] of NOMES_UF) {
    if (new RegExp(`\\b${nome}\\b`).test(texto)) return uf;
  }
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
  // Designada pela CAIXA em 07/09/2026 como primeira cidade real de
  // Fluxo Pareado — especificamente a CIDADE de São Paulo/SP, não a
  // Região Metropolitana inteira (por isso o nome não usa prefixo "rm-",
  // diferente de Campinas/Rio/BH/Vale do Paraíba abaixo).
  { padroes: ["sao paulo"], cidade: "sao-paulo-sp-capital" },

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
    { padroes: ["sqsw", "clsw", "crsw", "sudoeste"], regiao: "setor sudoeste" },
    { padroes: ["sqnw", "clnw", "noroeste"], regiao: "noroeste" },
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
  // São Paulo: bairro por nome. ORDEM IMPORTA — nomes mais específicos
  // antes dos genéricos que os contêm (ex: "vila mariana" antes de
  // "vila maria"; "alto de pinheiros" antes de "pinheiros"). Bairros com
  // nome genérico demais pra casar com segurança no endereço (Centro,
  // Liberdade, Paraíso, Bela Vista, Brás, República, Luz, Penha) ficam de
  // fora de propósito e caem no valor da cidade + revisão manual.
  "sao-paulo-sp-capital": [
    { padroes: ["vila nova conceicao"], regiao: "vila nova conceicao" },
    { padroes: ["jardim europa"], regiao: "jardim europa" },
    { padroes: ["jardim paulistano"], regiao: "jardim paulistano" },
    { padroes: ["jardim paulista"], regiao: "jardim paulista" },
    { padroes: ["jardim america da penha"], regiao: null }, // homônimo barato — não confundir com Jd. América
    { padroes: ["jardim america"], regiao: "jardim america" },
    { padroes: ["itaim bibi"], regiao: "itaim bibi" },
    { padroes: ["cerqueira cesar"], regiao: "cerqueira cesar" },
    { padroes: ["alto de pinheiros", "alto pinheiros"], regiao: "alto de pinheiros" },
    { padroes: ["jardim das perdizes"], regiao: "jardim das perdizes" },
    { padroes: ["vila olimpia"], regiao: "vila olimpia" },
    { padroes: ["moema"], regiao: "moema" },
    { padroes: ["vila madalena"], regiao: "vila madalena" },
    { padroes: ["pinheiros"], regiao: "pinheiros" },
    { padroes: ["brooklin"], regiao: "brooklin" },
    { padroes: ["chacara klabin"], regiao: "chacara klabin" },
    { padroes: ["vila leopoldina"], regiao: "vila leopoldina" },
    { padroes: ["alto da lapa"], regiao: "alto da lapa" },
    { padroes: ["lapa de baixo"], regiao: null },
    { padroes: ["vila clementino"], regiao: "vila clementino" },
    { padroes: ["vila mariana"], regiao: "vila mariana" },
    { padroes: ["pompeia"], regiao: "pompeia" },
    { padroes: ["agua branca"], regiao: "agua branca" },
    { padroes: ["higienopolis"], regiao: "higienopolis" },
    { padroes: ["campo belo"], regiao: "campo belo" },
    { padroes: ["perdizes"], regiao: "perdizes" },
    { padroes: ["barra funda"], regiao: "barra funda" },
    { padroes: ["consolacao"], regiao: "consolacao" },
    { padroes: ["santo amaro"], regiao: "santo amaro" },
    { padroes: ["lapa"], regiao: "lapa" },
    { padroes: ["analia franco"], regiao: "analia franco" },
    { padroes: ["tatuape"], regiao: "tatuape" },
    { padroes: ["santa cecilia"], regiao: "santa cecilia" },
    { padroes: ["pacaembu"], regiao: "pacaembu" },
    { padroes: ["ipiranga"], regiao: "ipiranga" },
    { padroes: ["vila maria alta"], regiao: null },
    { padroes: ["vila maria"], regiao: "vila maria" },
    { padroes: ["belenzinho"], regiao: "belenzinho" },
    { padroes: ["saude"], regiao: "saude" },
    { padroes: ["vila butanta"], regiao: null },
    { padroes: ["butanta"], regiao: "butanta" },
    { padroes: ["casa verde"], regiao: "casa verde" },
    { padroes: ["alto de santana", "chacara santana"], regiao: null },
    { padroes: ["santana"], regiao: "santana" },
    { padroes: ["aclimacao"], regiao: "aclimacao" },
    { padroes: ["mooca"], regiao: "mooca" },
    { padroes: ["tucuruvi"], regiao: "tucuruvi" },
    { padroes: ["vila guilherme"], regiao: "vila guilherme" },
    { padroes: ["parque da vila prudente"], regiao: null },
    { padroes: ["vila prudente"], regiao: "vila prudente" },
    { padroes: ["vila sonia"], regiao: "vila sonia" },
    { padroes: ["interlagos"], regiao: "interlagos" },
    { padroes: ["vila carrao"], regiao: "vila carrao" },
    { padroes: ["jaguare"], regiao: "jaguare" },
    { padroes: ["vila formosa"], regiao: "vila formosa" },
    { padroes: ["paraiso do morumbi", "fonte do morumbi", "parque do morumbi", "portal do morumbi"], regiao: null },
    { padroes: ["morumbi"], regiao: "morumbi" },
    { padroes: ["freguesia do o"], regiao: "freguesia do o" },
    { padroes: ["vila matilde"], regiao: "vila matilde" },
    { padroes: ["cambuci"], regiao: "cambuci" },
    { padroes: ["vila andrade"], regiao: "vila andrade" },
    { padroes: ["sapopemba"], regiao: "sapopemba" },
    { padroes: ["jabaquara"], regiao: "jabaquara" },
    { padroes: ["cidade ademar"], regiao: "cidade ademar" },
    { padroes: ["mandaqui"], regiao: "mandaqui" },
    { padroes: ["itaquera"], regiao: "itaquera" },
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

  // Nenhum nome casou, mas a UF foi detectada com segurança:
  // - DF só tem uma "cidade" no modelo (Brasília e RAs), então "Registro
  //   de Imóveis do DF" sem nome de cidade já basta.
  // - Em SP, os cartórios da capital se identificam como "da Capital"
  //   (ex: "14º Oficial de Registro de Imóveis da Capital - SP").
  if (ufDetectada === "df") return "brasilia-df";
  if (ufDetectada === "sp" && /\bcapital\b/.test(texto)) return "sao-paulo-sp-capital";

  return null; // cidade não reconhecida — não inventar, sinalizar
}

function identificarRegiao(enderecoCompleto, cidade) {
  const padroesDaCidade = PADROES_REGIAO_POR_CIDADE[cidade];
  if (!padroesDaCidade) return null;
  const texto = normalizar(enderecoCompleto);
  for (const { padroes, regiao } of padroesDaCidade) {
    // regiao: null = homônimo conhecido de propósito sem preço próprio —
    // para a busca aqui (não deixa cair no padrão genérico errado).
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
    fonte: infoRegiao ? infoRegiao.fonte : (tabelaCidade.fonte_fallback || "fallback_medio_cidade"),
    amostraN: infoRegiao && Number.isFinite(infoRegiao.n) ? infoRegiao.n : null,
    regiao: infoRegiao ? regiao : null,
    cidade,
  };
}

// Fontes de preço consideradas "de referência" (não placeholder). Fora
// desta lista, a precificação sai mas vai pra revisão manual.
const FONTES_DE_REFERENCIA = new Set(["estimativa_terceiro", "mediana_anuncios_bairro"]);
const AMOSTRA_MINIMA_CONFIAVEL = 20;

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

// Lê área vinda da extração. Formatos esperados:
//   brasileiro: "1.234,56" / "65,32" (vírgula decimal, ponto milhar)
//   internacional: "65.32" / 65.32 (número JSON)
// O caso perigoso é "1.200" (um ponto, exatamente 3 dígitos depois): em
// matrícula brasileira isso é MIL E DUZENTOS, mas um "65.320" pode ser o
// LLM convertendo "65,320" pra ponto decimal. Antes, "1.200" virava
// 1,2 m² sem nenhum aviso (bug real: imóvel de 1.200 m² precificado a
// R$ 15 mil e marcado "OK"). Agora resolve pela plausibilidade e, se a
// leitura foi ambígua, devolve ambigua=true pra forçar revisão manual.
const AREA_MIN_PLAUSIVEL = 15;      // m² — abaixo disso, só box/vaga
const AREA_MAX_PLAUSIVEL = 50000;   // m² — gleba grande; acima é erro

function interpretarArea(valor) {
  if (valor === null || valor === undefined || valor === "") return { valor: null, ambigua: false };
  if (typeof valor === "number") {
    return { valor: Number.isFinite(valor) && valor > 0 ? valor : null, ambigua: false };
  }
  let texto = valor.toString().replace(/m²|m2|metros quadrados/gi, "").replace(/\s/g, "").trim();
  if (!texto) return { valor: null, ambigua: false };

  const temVirgula = texto.includes(",");
  const qtdPontos = (texto.match(/\./g) || []).length;
  const plausivel = (n) => n >= AREA_MIN_PLAUSIVEL && n <= AREA_MAX_PLAUSIVEL;

  if (temVirgula) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (qtdPontos > 1) {
    texto = texto.replace(/\./g, "");
  } else if (qtdPontos === 1 && /^\d{1,3}\.\d{3}$/.test(texto)) {
    // "1.200" ou "65.320": duas leituras possíveis
    const comoDecimal = parseFloat(texto);
    const comoMilhar = parseFloat(texto.replace(".", ""));
    const decOk = plausivel(comoDecimal);
    const milOk = plausivel(comoMilhar);
    if (milOk && !decOk) return { valor: comoMilhar, ambigua: false };
    if (decOk && !milOk) return { valor: comoDecimal, ambigua: false };
    // As duas plausíveis (ex: "15.000") ou nenhuma: usa a convenção
    // brasileira (milhar), mas marca como ambígua.
    return { valor: comoMilhar, ambigua: true };
  }

  const num = parseFloat(texto);
  return { valor: Number.isFinite(num) && num > 0 ? num : null, ambigua: false };
}

function parseAreaString(valor) {
  return interpretarArea(valor).valor;
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
    return null;
  }
  try {
    const linhas = await sql`
      INSERT INTO precificacoes (
        numero_matricula, endereco_completo, cidade_identificada, regiao_identificada,
        area_privativa_m2, area_total_m2, vaga_garagem,
        preco_m2_utilizado, fonte_preco_m2, valor_estimado, fator_ajuste,
        confianca_extracao, imovel_pertence_caixa, onus_ativos, alertas_extracao,
        precisa_revisao_manual, extracao_bruta, precificacao_bruta, tempo_total_ms,
        tipo_resposta, motivo_recusa, fundamentacao_recusa
      ) VALUES (
        ${dados.numero_matricula || null}, ${dados.endereco_completo || null},
        ${calculo.cidade}, ${calculo.regiao},
        ${parseAreaString(dados.area_privativa_m2)}, ${parseAreaString(dados.area_total_m2)},
        ${dados.vaga_garagem ?? null},
        ${calculo.precoM2}, ${calculo.fonte}, ${respostaFinal.valor_estimado ?? null}, ${calculo.ajuste},
        ${dados.confianca_extracao || null}, ${dados.imovel_pertence_caixa ?? null},
        ${JSON.stringify(dados.onus_ativos || [])}, ${JSON.stringify(dados.alertas || [])},
        ${respostaFinal.precisa_revisao_manual ?? null},
        ${JSON.stringify(dados)}, ${JSON.stringify(respostaFinal)}, ${calculo.tempoTotalMs},
        ${calculo.tipoResposta || "estimativa"}, ${calculo.motivoRecusa || null}, ${calculo.fundamentacaoRecusa || null}
      )
      RETURNING id
    `;
    return linhas[0]?.id ?? null;
  } catch (dbErr) {
    console.error("Falha ao gravar histórico (não afeta a resposta):", dbErr.message);
    return null;
  }
}

// ============================================================
// RECUSA FORMAL — item 9.5 do Anexo I. A OS deve ser RECUSADA (não só
// "estimada com ressalva") em 4 situações específicas. Isso é diferente
// de precisa_revisao_manual: recusa significa "não há precificação
// nenhuma pra entregar", revisão manual significa "há uma estimativa,
// mas alguém deveria confirmar antes de considerar definitiva".
// ============================================================

// (c) Conflito de interesse — não é detectável a partir dos dados de UM
// documento isolado (depende de relação societária/familiar da empresa,
// não do imóvel). Estrutura pronta e funcional, mas a lista em si
// precisa ser alimentada pelo time jurídico/compliance — hoje vazia.
// Configurar via variável de ambiente LISTA_DOCUMENTOS_CONFLITO (CPF/CNPJ
// separados por vírgula) se/quando houver uma lista real.
function verificarConflitoInteresse(dados) {
  const listaConfigurada = process.env.LISTA_DOCUMENTOS_CONFLITO;
  if (!listaConfigurada) return { conflito: false };

  const documentosEmConflito = listaConfigurada.split(",").map((d) => d.trim());
  const documentoImovel = (dados.proprietario_atual_documento || "").replace(/\D/g, "");

  const bateu = documentosEmConflito.some((doc) => doc.replace(/\D/g, "") === documentoImovel && documentoImovel !== "");
  return { conflito: bateu };
}

// Avalia as 4 condições do item 9.5, na ordem em que fazem sentido
// verificar (dado disponível antes de calcular vs. depois). Retorna
// null se não há motivo de recusa (segue fluxo normal de estimativa).
function avaliarRecusa(dados, areaPrivativa, areaTotal, area, calculo) {
  // (b) Incoerência entre os dados — checagem concreta: área privativa
  // não pode ser maior que área total, é logicamente impossível.
  if (areaPrivativa && areaTotal && areaPrivativa > areaTotal) {
    return {
      motivo: "b",
      fundamentacao: `Incoerência nos dados: área privativa (${areaPrivativa} m2) maior que área total (${areaTotal} m2), o que não é fisicamente possível.`,
    };
  }

  // (a) Modelo não permite precificar — sem área utilizável nenhuma
  if (!area) {
    return {
      motivo: "a",
      fundamentacao: "Não foi possível determinar a área do imóvel (áreas privativa, construída e total ausentes ou inválidas) — o modelo não tem base pra calcular um valor.",
    };
  }

  // (d) Sem convicção sobre a localização — cidade TOTALMENTE não
  // reconhecida (diferente de cidade conhecida sem preço configurado,
  // que é tratado como (a) logo abaixo — nesse caso SABEMOS onde é,
  // só não temos preço de referência validado ainda).
  if (calculo.cidade === "nao_identificada") {
    // Se a UF foi identificada com segurança, a localização É conhecida —
    // o imóvel só está fora da cobertura do modelo. Isso é motivo (a), não
    // (d). (d) fica pra quando nem a UF dá pra afirmar.
    const uf = detectarQualquerUF(dados.comarca_uf);
    if (uf) {
      return {
        motivo: "a",
        fundamentacao: `Imóvel localizado fora da área de cobertura do modelo nesta versão (comarca "${dados.comarca_uf}", UF ${uf.toUpperCase()}). O modelo ${METADADOS_MODELO.versao} tem preço de referência apenas para São Paulo/SP (capital), Brasília/DF e municípios do Entorno do DF em Goiás.`,
      };
    }
    return {
      motivo: "d",
      fundamentacao: `Não foi possível identificar com convicção a cidade/região do imóvel a partir do endereço e comarca informados ("${dados.endereco_completo || "endereço ausente"}" / "${dados.comarca_uf || "comarca ausente"}").`,
    };
  }

  // (a) Cidade reconhecida, mas sem preço de referência configurado —
  // sabemos ONDE é, mas o modelo não tem dado suficiente pra precificar
  // ali ainda (ex: uma das cidades novas do Anexo III sem tabela).
  if (calculo.fonte === "cidade_nao_configurada") {
    return {
      motivo: "a",
      fundamentacao: `Cidade identificada como "${calculo.cidade}", mas ainda não há preço de referência validado configurado pra essa localidade — o modelo não tem base suficiente pra precificar aqui.`,
    };
  }

  // (c) Conflito de interesse — placeholder funcional, ver comentário acima
  const { conflito } = verificarConflitoInteresse(dados);
  if (conflito) {
    return {
      motivo: "c",
      fundamentacao: "Proprietário do imóvel consta na lista de conflito de interesse configurada.",
    };
  }

  return null; // nenhum motivo de recusa — segue pro fluxo normal
}

// ============================================================
// CHECAGEM DE ELEGIBILIDADE — sinal adicional, específico por cidade,
// NÃO é um dos 4 motivos formais de recusa do item 9.5. Hoje só São
// Paulo tem critério definido (carta CAIXA GEHPA de 07/09/2026). Outras
// cidades retornam null aqui — não têm critério de elegibilidade
// comunicado ainda, então não se aplica checagem nenhuma.
// ============================================================

const CRITERIOS_ELEGIBILIDADE_POR_CIDADE = {
  "sao-paulo-sp-capital": {
    tipos_imovel_aceitos: ["apartamento"],
    area_min_m2: 35,
    area_max_m2: 250,
    valor_max: 2250000,
    idade_max_anos: 20,
    fonte: "Carta CAIXA GEHPA de 07/09/2026",
  },
};

// Datas no historico_atos_relevantes vêm no formato DD/MM/AAAA (visto em
// documentos reais já processados).
function parseDataBR(texto) {
  if (!texto) return null;
  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, aaaa] = match;
  const data = new Date(Number(aaaa), Number(mm) - 1, Number(dd));
  return Number.isNaN(data.getTime()) ? null : data;
}

// Estimativa APROXIMADA da idade da construção — não existe campo
// direto no schema do extract.js, então inferimos pelo ato mais antigo
// do tipo "Construção" no histórico. Se não houver esse ato, retorna
// null (não trava, só não avalia esse critério específico).
function estimarIdadeConstrucao(historicoAtos, agora = new Date()) {
  if (!Array.isArray(historicoAtos)) return null;
  const atosConstrucao = historicoAtos.filter((a) => normalizar(a.tipo).includes("construc"));
  if (atosConstrucao.length === 0) return null;
  const datas = atosConstrucao.map((a) => parseDataBR(a.data)).filter((d) => d !== null);
  if (datas.length === 0) return null;
  const maisAntiga = new Date(Math.min(...datas.map((d) => d.getTime())));
  const anos = (agora - maisAntiga) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.floor(anos);
}

function verificarElegibilidade(dados, cidade, valorEstimado) {
  const criterios = CRITERIOS_ELEGIBILIDADE_POR_CIDADE[cidade];
  if (!criterios) return null; // cidade sem critério comunicado — não avalia

  const motivos = [];
  const tipoNormalizado = normalizar(dados.tipo_imovel);
  if (!criterios.tipos_imovel_aceitos.some((t) => tipoNormalizado.includes(t))) {
    motivos.push(`Tipo de imóvel "${dados.tipo_imovel || "não informado"}" fora do critério (aceito: ${criterios.tipos_imovel_aceitos.join(", ")})`);
  }

  const area = parseAreaString(dados.area_privativa_m2);
  if (area !== null && (area < criterios.area_min_m2 || area > criterios.area_max_m2)) {
    motivos.push(`Área privativa ${area} m2 fora da faixa ${criterios.area_min_m2}-${criterios.area_max_m2} m2`);
  }

  if (valorEstimado !== null && valorEstimado > criterios.valor_max) {
    motivos.push(`Valor estimado R$ ${valorEstimado} acima do limite de R$ ${criterios.valor_max}`);
  }

  const idadeEstimada = estimarIdadeConstrucao(dados.historico_atos_relevantes);
  if (idadeEstimada !== null && idadeEstimada > criterios.idade_max_anos) {
    motivos.push(`Idade estimada da construção (~${idadeEstimada} anos, aproximado) acima do limite de ${criterios.idade_max_anos} anos`);
  }

  return {
    cidade_com_criterio: cidade,
    fonte_criterio: criterios.fonte,
    dentro_do_criterio: motivos.length === 0,
    motivos_fora_do_criterio: motivos,
    idade_construcao_estimada_anos: idadeEstimada,
    aviso: "Sinal adicional de elegibilidade, não é um dos 4 motivos formais de recusa do item 9.5. Financiamento SBPE/SFH/SFI não é verificável a partir da matrícula — não incluído nesta checagem.",
  };
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

    // Ordem de preferência da área-base do cálculo:
    //   1. privativa (apartamento/sala/loja — base dos preços/m² de referência)
    //   2. construída (casa/sobrado — quando não há "privativa")
    //   3. total da unidade (último recurso, sempre com revisão)
    // A área do TERRENO nunca é usada como base: em apartamento ela é do
    // prédio inteiro; em casa, multiplicá-la pelo preço/m² de construção
    // superestima (bug relatado no teste ao vivo de 02/10/2026).
    const leituraPrivativa = interpretarArea(dados.area_privativa_m2);
    const leituraConstruida = interpretarArea(dados.area_construida_m2);
    const leituraTotal = interpretarArea(dados.area_total_m2);
    const areaPrivativa = leituraPrivativa.valor;
    const areaConstruida = leituraConstruida.valor;
    const areaTotal = leituraTotal.valor;
    const areaTerreno = interpretarArea(dados.area_terreno_m2).valor;
    const [area, origemArea, areaAmbigua] = areaPrivativa
      ? [areaPrivativa, "area_privativa_m2", leituraPrivativa.ambigua]
      : areaConstruida
      ? [areaConstruida, "area_construida_m2 (privativa ausente)", leituraConstruida.ambigua]
      : areaTotal
      ? [areaTotal, "area_total_m2 (privativa e construída ausentes)", leituraTotal.ambigua]
      : [null, null, false];

    const calculo = obterPrecoM2(dados);

    const decisaoRecusa = avaliarRecusa(dados, areaPrivativa, areaTotal, area, calculo);
    const tempoExtracaoMs = Number.isFinite(Number(dados._tempo_extracao_ms))
      ? Number(dados._tempo_extracao_ms)
      : null;
    const LIMITE_SLA_MS = 5 * 60 * 1000; // 5 minutos — item 9.5 do Anexo I

    if (decisaoRecusa) {
      const tempoPrecificacaoMs = Date.now() - inicioPrecificacao;
      const tempoTotalMs = tempoExtracaoMs !== null ? tempoExtracaoMs + tempoPrecificacaoMs : null;

      const respostaRecusa = {
        tipo_resposta: "recusa",
        id_registro: null,
        motivo_recusa: decisaoRecusa.motivo,
        motivo_descricao: {
          a: "O modelo estatístico não permite a precificação do imóvel",
          b: "Incoerência entre os dados fornecidos para a precificação",
          c: "Conflito de interesses",
          d: "Não há convicção sobre a efetiva localização do imóvel",
        }[decisaoRecusa.motivo],
        fundamentacao: decisaoRecusa.fundamentacao,
        cidade_identificada: calculo.cidade,
        modelo: METADADOS_MODELO,
        responsaveis_tecnicos: RESPONSAVEIS_TECNICOS,
        tempo_processamento: {
          extracao_ms: tempoExtracaoMs,
          precificacao_ms: tempoPrecificacaoMs,
          total_ms: tempoTotalMs,
          dentro_do_sla_5min: tempoTotalMs !== null ? tempoTotalMs <= LIMITE_SLA_MS : null,
        },
        timestamp: new Date().toISOString(),
      };

      respostaRecusa.id_registro = await gravarHistorico(
        dados,
        { ...calculo, ajuste: null, tempoTotalMs, tipoResposta: "recusa", motivoRecusa: decisaoRecusa.motivo, fundamentacaoRecusa: decisaoRecusa.fundamentacao },
        respostaRecusa
      );

      // HTTP 200: o sistema funcionou corretamente e chegou a uma decisão
      // válida (recusar). Não é erro de sistema, é resultado de negócio.
      return res.status(200).json(respostaRecusa);
    }

    const { precoM2, fonte, regiao, cidade, amostraN } = calculo;
    const valorBase = area * precoM2;
    const { ajuste, detalhes } = calcularAjuste(dados);
    const valorEstimado = Math.round(valorBase * ajuste);

    const elegibilidade = verificarElegibilidade(dados, cidade, valorEstimado);

    // Cada motivo que manda pra revisão manual fica explícito na resposta
    // (e no relatório) — "precisa revisão" sem dizer por quê não ajuda o
    // engenheiro que vai revisar.
    const motivosRevisao = [];
    let detalhesTrecho = null;
    if (!regiao) motivosRevisao.push("Bairro/região não reconhecido no endereço — usado o valor médio da cidade.");
    if (!FONTES_DE_REFERENCIA.has(fonte)) motivosRevisao.push(`Preço/m² de fonte não validada (${fonte}).`);
    if (amostraN !== null && amostraN < AMOSTRA_MINIMA_CONFIAVEL) motivosRevisao.push(`Amostra pequena no bairro (${amostraN} anúncios; mínimo ${AMOSTRA_MINIMA_CONFIAVEL}).`);
    if (confiancaExigeRevisao(dados.confianca_extracao)) motivosRevisao.push(`Confiança da extração "${dados.confianca_extracao || "não informada"}".`);
    if (dados.imovel_pertence_caixa === null || dados.imovel_pertence_caixa === undefined) motivosRevisao.push("Não foi possível determinar se o imóvel pertence à CAIXA.");
    if (areaAmbigua) motivosRevisao.push(`Área com leitura ambígua (valor extraído: "${areaPrivativa ? dados.area_privativa_m2 : dados.area_total_m2}") — conferir na matrícula.`);
    if (!areaPrivativa && !areaConstruida && areaTotal) motivosRevisao.push("Áreas privativa e construída ausentes — usada a área total da unidade; conferir na matrícula.");
    if (areaTerreno && area && Math.abs(area - areaTerreno) < 0.01) motivosRevisao.push("A área usada no cálculo é igual à área do terreno — possível confusão entre área do lote/prédio e área da unidade.");
    if (dados.area_trecho_fonte) detalhesTrecho = String(dados.area_trecho_fonte).slice(0, 200);
    if (elegibilidade !== null && !elegibilidade.dentro_do_criterio) motivosRevisao.push("Fora do critério de elegibilidade da cidade: " + elegibilidade.motivos_fora_do_criterio.join("; ") + ".");

    const precisaRevisaoManual = motivosRevisao.length > 0;

    const tempoPrecificacaoMs = Date.now() - inicioPrecificacao;
    const tempoTotalMs = tempoExtracaoMs !== null ? tempoExtracaoMs + tempoPrecificacaoMs : null;

    const respostaFinal = {
      tipo_resposta: "estimativa",
      id_registro: null,
      valor_estimado: valorEstimado,
      moeda: "BRL",
      modelo: METADADOS_MODELO,
      responsaveis_tecnicos: RESPONSAVEIS_TECNICOS,
      detalhes_calculo: {
        area_utilizada_m2: area,
        origem_area: origemArea,
        area_leitura_ambigua: areaAmbigua,
        area_trecho_fonte: detalhesTrecho,
        areas_extraidas: {
          privativa: areaPrivativa, construida: areaConstruida, total: areaTotal,
          terreno: areaTerreno, comum: interpretarArea(dados.area_comum_m2).valor,
        },
        cidade_identificada: cidade,
        endereco_original: dados.endereco_completo || null,
        regiao_identificada: regiao || "não reconhecida (endereço não bateu com padrões conhecidos)",
        preco_m2_utilizado: precoM2,
        fonte_preco_m2: fonte,
        amostra_anuncios_regiao: amostraN,
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
      elegibilidade,
      tempo_processamento: {
        extracao_ms: tempoExtracaoMs,
        precificacao_ms: tempoPrecificacaoMs,
        total_ms: tempoTotalMs,
        dentro_do_sla_5min: tempoTotalMs !== null ? tempoTotalMs <= LIMITE_SLA_MS : null,
      },
      precisa_revisao_manual: precisaRevisaoManual,
      motivos_revisao: motivosRevisao,
      corrigido_manualmente: dados._corrigido_manualmente === true,
      timestamp: new Date().toISOString(),
    };

    respostaFinal.id_registro = await gravarHistorico(
      dados,
      { precoM2, fonte, regiao, cidade, ajuste, tempoTotalMs, tipoResposta: "estimativa" },
      respostaFinal
    );

    return res.status(200).json(respostaFinal);
  } catch (err) {
    console.error("Erro ao calcular precificação:", err);
    return res.status(500).json({ erro: "Erro interno ao calcular precificação." });
  }
}
