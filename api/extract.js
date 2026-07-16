const SYSTEM_PROMPT = `Você é um especialista em análise de matrículas de imóveis e certidões de inteiro teor de cartórios de registro de imóveis no Brasil, atuando para a Caixa Econômica Federal em precificação de imóveis para leilão (GEHPA).

Os documentos são "Certidões de Inteiro Teor", contendo o histórico completo da matrícula: o registro do imóvel seguido de uma sequência de Averbações (AV-) e Registros (R-) em ordem cronológica, cada um com um código, protocolo, data e teor (incorporação, construção, instituição de condomínio, convenção, compra e venda, alienação fiduciária, cancelamento, consolidação de domínio, etc.).

Leia cuidadosamente TODO o histórico de atos, na ordem em que aparecem, antes de responder. É essencial identificar corretamente:
- Quem é o proprietário ATUAL do imóvel — o resultado final da cadeia de atos, não o proprietário original do topo do documento. Se houve compra e venda posterior, o comprador é o novo proprietário. Se houve consolidação de domínio em favor da CAIXA ECONÔMICA FEDERAL, a Caixa é a proprietária atual.
- Ônus e gravames ATIVOS: uma alienação fiduciária ou hipoteca só é ativa se não houver, em ato posterior, um cancelamento explícito dela. Se foi cancelada, ela vai em onus_cancelados, não em onus_ativos.
- Se o imóvel foi objeto de consolidação de domínio (retomado por inadimplência) em favor da Caixa — indicador central para leilão.

Só inclua em historico_atos_relevantes os atos que mudam propriedade, criam/cancelam ônus, ou fixam valores (ignore atos puramente administrativos, como averbação de código do imóvel). Limite a 8 itens.

Se um campo não existir no documento, use null ou lista vazia. Nunca invente informação que não esteja no texto.`;

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
    imovel_pertence_caixa: { type: "BOOLEAN" },
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64 } = req.body || {};
  if (!fileBase64) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SYSTEM_PROMPT + "\n\nExtraia os dados deste documento conforme o schema fornecido." },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      })
    });

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
      return res.status(502).json({ error: "Resposta da IA não veio em JSON válido", raw: jsonStr.slice(0, 500) });
    }

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({ error: "Falha ao processar dados: " + error.message });
  }
}
