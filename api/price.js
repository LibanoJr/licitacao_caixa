// api/extract.js
// Extração de dados de Certidão de Inteiro Teor via Gemini — CR 12/2026 CAIXA (GEHPA)
//
// SYSTEM_PROMPT e RESPONSE_SCHEMA são a parte de domínio — mantidos como
// estavam. Mudanças desta revisão são de infraestrutura: segurança,
// robustez, LGPD, e agora controle de custo (opt-in).

import { neon } from "@neondatabase/serverless";

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

// Limite diário de chamadas ao Gemini — OPCIONAL. Se a variável de
// ambiente LIMITE_DIARIO_GEMINI não for configurada na Vercel, este
// bloco fica completamente inativo e o comportamento é IDÊNTICO ao de
// antes (sem limite, sem checagem, sem mudança de fluxo).
const LIMITE_DIARIO_GEMINI = process.env.LIMITE_DIARIO_GEMINI
  ? Number(process.env.LIMITE_DIARIO_GEMINI)
  : null;

const SYSTEM_PROMPT = `Você é um especialista em análise de matrículas de imóveis e certidões de inteiro teor de cartórios de registro de imóveis no Brasil, atuando para a Caixa Econômica Federal em precificação de imóveis para leilão (GEHPA).

Os documentos são "Certidões de Inteiro Teor", contendo o histórico completo da matrícula: o registro do imóvel seguido de uma sequência de Averbações (AV-) e Registros (R-) em ordem cronológica, cada um com um código, protocolo, data e teor (incorporação, construção, instituição de condomínio, convenção, compra e venda, alienação fiduciária, cancelamento, consolidação de domínio, etc.).

Leia cuidadosamente TODO o histórico de atos, na ordem em que aparecem, antes de responder. É essencial identificar corretamente:
- Quem é o proprietário ATUAL do imóvel — o resultado final da cadeia de atos, não o proprietário original do topo do documento. Se houve compra e venda posterior, o comprador é o novo proprietário. Se houve consolidação de domínio em favor da CAIXA ECONÔMICA FEDERAL, a Caixa é a proprietária atual.
- Ônus e gravames ATIVOS: uma alienação fiduciária ou hipoteca só é ativa se não houver, em ato posterior, um cancelamento explícito dela. Se foi cancelada, ela vai em onus_cancelados, não em onus_ativos.
- Se o imóvel foi objeto de consolidação de domínio (retomado por inadimplência) em favor da Caixa — indicador central para leilão.

Só inclua em historico_atos_relevantes os atos que mudam propriedade, criam/cancelam ônus, ou fixam valores (ignore atos puramente administrativos, como averbação de código do imóvel). Limite a 8 itens.

Se um campo não existir no documento, use null ou lista vazia. Nunca invente informação que não esteja no texto.

Critério para confianca_extracao (aplique com rigor — na dúvida entre dois níveis, escolha sempre o mais baixo):
- "baixa": há texto ilegível, cortado, borrado, páginas faltando, ou informação central (proprietário atual, ônus ativos) ambígua ou conflitante entre trechos do documento.
- "media": o essencial (proprietário atual, ônus ativos) está claro, mas algum campo secundário (área, endereço completo, valores) está incerto, parcialmente ilegível ou precisou ser inferido.
- "alta": todos os campos relevantes estão claramente legíveis, sem ambiguidade e sem necessidade de inferência.

Critério para imovel_pertence_caixa: só marque true ou false se o texto permitir concluir isso com segurança. Se não for possível determinar com confiança se a Caixa Econômica Federal é a proprietária atual, retorne null e explique o motivo em 'alertas' — não arrisque um chute nesse campo, ele é usado para decisão de leilão.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    numero_matricula: { type: "STRING", nullable: true },
    cnm: { type: "STRING", nullable: true },
    cartorio_nome: { type: "STRING", nullable: true },
    comarca_uf: { type: "STRING", nullable: true },
    selo_digital: { type: "STRING", nullable: true },
    data_certidao: { type: "STRING", nullable: true },
    tipo_imovel: { type: "STRING", nullable: true },
    endereco_completo: { type: "STRING", nullable: true },
    area_privativa_m2: { type: "STRING", nullable: true },
    area_total_m2: { type: "STRING", nullable: true },
    area_comum_m2: { type: "STRING", nullable: true },
    vaga_garagem: { type: "BOOLEAN", nullable: true },
    proprietario_atual_nome: { type: "STRING", nullable: true },
    proprietario_atual_documento: { type: "STRING", nullable: true },
    imovel_pertence_caixa: { type: "BOOLEAN", nullable: true },
    matricula_origem: { type: "STRING", nullable: true },
    programa_habitacional: { type: "STRING", nullable: true },
    historico_atos_relevantes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          codigo: { type: "STRING" },
          data: { type: "STRING" },
          tipo: { type: "STRING" },
          resumo: { type: "STRING" }
        }
      }
    },
    onus_ativos: { type: "ARRAY", items: { type: "STRING" } },
    onus_cancelados: { type: "ARRAY", items: { type: "STRING" } },
    valores_mencionados: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tipo: { type: "STRING" },
          valor: { type: "STRING" }
        }
      }
    },
    alertas: { type: "ARRAY", items: { type: "STRING" } },
    confianca_extracao: { type: "STRING", enum: ["alta", "media", "baixa"] }
  },
  required: ["numero_matricula", "tipo_imovel", "imovel_pertence_caixa", "confianca_extracao"]
};

async function callGeminiWithRetry(url, body, headers, maxRetries = 2) {
  let lastResponse;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (response.status !== 429 && response.status !== 500 && response.status !== 503) {
      return response;
    }
    lastResponse = response;
    if (attempt < maxRetries) {
      const waitMs = 1500 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  return lastResponse;
}

function pareceSerPdfValido(fileBase64) {
  try {
    const amostra = Buffer.from(fileBase64.slice(0, 40), 'base64').toString('utf-8');
    return amostra.startsWith('%PDF');
  } catch {
    return false;
  }
}

// Só age se LIMITE_DIARIO_GEMINI estiver configurado. Se o banco falhar
// ao verificar, DEIXA PASSAR (fail-open) — uma falha no monitoramento
// nunca deve travar o produto principal.
async function verificarLimiteDiario() {
  if (!sql || !LIMITE_DIARIO_GEMINI) return { bloqueado: false, totalHoje: 0 };
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const resultado = await sql`SELECT total_chamadas FROM uso_gemini WHERE data = ${hoje}`;
    const totalHoje = resultado[0]?.total_chamadas || 0;
    return { bloqueado: totalHoje >= LIMITE_DIARIO_GEMINI, totalHoje };
  } catch (err) {
    console.error('Falha ao checar limite diário (permitindo chamada):', err.message);
    return { bloqueado: false, totalHoje: 0 };
  }
}

// Registra a chamada pro contador. Silenciosamente ignora erro — nunca
// derruba a resposta principal por causa disso.
async function registrarChamadaGemini(sucesso) {
  if (!sql) return;
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    await sql`
      INSERT INTO uso_gemini (data, total_chamadas, total_sucesso, total_erro)
      VALUES (${hoje}, 1, ${sucesso ? 1 : 0}, ${sucesso ? 0 : 1})
      ON CONFLICT (data) DO UPDATE SET
        total_chamadas = uso_gemini.total_chamadas + 1,
        total_sucesso = uso_gemini.total_sucesso + ${sucesso ? 1 : 0},
        total_erro = uso_gemini.total_erro + ${sucesso ? 0 : 1}
    `;
  } catch (err) {
    console.error('Falha ao registrar uso (não afeta a resposta):', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const expectedKey = process.env.APP_ACCESS_KEY;
  if (expectedKey) {
    const providedKey = req.headers['x-app-key'];
    if (providedKey !== expectedKey) {
      return res.status(401).json({ error: 'Chave de acesso inválida ou ausente. Confirme a chave com quem coordena o teste.' });
    }
  }

  const { fileBase64 } = req.body || {};
  if (!fileBase64) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  if (!pareceSerPdfValido(fileBase64)) {
    return res.status(400).json({ error: 'O arquivo enviado não parece ser um PDF válido.' });
  }

  // Só bloqueia se LIMITE_DIARIO_GEMINI estiver configurado — sem essa
  // env var, este trecho não muda nada do comportamento atual.
  const { bloqueado, totalHoje } = await verificarLimiteDiario();
  if (bloqueado) {
    return res.status(429).json({
      error: `Limite diário de ${LIMITE_DIARIO_GEMINI} chamadas ao Gemini atingido (${totalHoje} hoje). Ajuste LIMITE_DIARIO_GEMINI na Vercel ou aguarde o próximo dia.`
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };

  try {
    const response = await callGeminiWithRetry(url, {
      contents: [{
        parts: [
          { text: SYSTEM_PROMPT + "\n\nExtraia os dados deste documento conforme o schema fornecido." },
          { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 8192
      }
    }, headers);

    // Registra a tentativa (sucesso = resposta HTTP OK do Gemini),
    // independente do que acontecer no parsing abaixo.
    await registrarChamadaGemini(response.ok);

    if (response.status === 429) {
      return res.status(429).json({ error: 'Limite de requisições do Gemini (tier gratuito) atingido. Aguarde cerca de 1 minuto e tente novamente.' });
    }
    if (response.status === 500 || response.status === 503) {
      return res.status(502).json({ error: 'API do Gemini instável no momento. Tente novamente em alguns segundos.' });
    }

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro na API do Google: " + data.error.message });
    }

    const candidate = data.candidates && data.candidates[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(502).json({
        error: "A IA não retornou texto. finishReason: " + (candidate && candidate.finishReason)
      });
    }

    const jsonStr = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Resposta da IA não veio em JSON válido:", jsonStr.slice(0, 500));
      return res.status(502).json({ error: "Resposta da IA não veio em JSON válido. Verifique os logs do servidor para detalhes." });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("Falha ao processar extração:", error);
    return res.status(500).json({ error: "Falha ao processar dados: " + error.message });
  }
}