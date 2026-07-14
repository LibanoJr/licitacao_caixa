export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' }
  }
};

const SYSTEM_PROMPT = `Você é um especialista em análise de matrículas de imóveis e certidões de inteiro teor de cartórios de registro de imóveis no Brasil, atuando para a Caixa Econômica Federal em precificação de imóveis para leilão (GEHPA).

Os documentos são "Certidões de Inteiro Teor", contendo o histórico completo da matrícula: o registro do imóvel seguido de uma sequência de Averbações (AV-) e Registros (R-) em ordem cronológica.

Leia cuidadosamente TODO o histórico de atos, na ordem em que aparecem, antes de responder. É essencial identificar corretamente:
- Quem é o proprietário ATUAL do imóvel.
- Ônus e gravames ATIVOS.
- Se o imóvel foi objeto de consolidação de domínio em favor da Caixa.

Retorne APENAS um objeto JSON válido (sem markdown, sem texto antes ou depois), exatamente neste formato:

{
  "numero_matricula": "string ou null",
  "cnm": "string ou null",
  "cartorio_nome": "string ou null",
  "comarca_uf": "string ou null",
  "selo_digital": "string ou null",
  "data_certidao": "string ou null",
  "tipo_imovel": "string curta",
  "endereco_completo": "string ou null",
  "area_privativa_m2": "string ou null",
  "area_total_m2": "string ou null",
  "area_comum_m2": "string ou null",
  "vaga_garagem": true ou false ou null,
  "proprietario_atual_nome": "string ou null",
  "proprietario_atual_documento": "string ou null",
  "imovel_pertence_caixa": true ou false,
  "matricula_origem": "string ou null",
  "programa_habitacional": "string ou null",
  "historico_atos_relevantes": [
    {"codigo": "ex: R-6", "data": "DD/MM/AAAA", "tipo": "ex: Compra e Venda", "resumo": "até 20 palavras"}
  ],
  "onus_ativos": ["lista curta"],
  "onus_cancelados": ["lista curta"],
  "valores_mencionados": [
    {"tipo": "ex: Valor de venda", "valor": "R$ X"}
  ],
  "alertas": ["pontos de atenção relevantes"],
  "confianca_extracao": "alta, media ou baixa"
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { fileBase64 } = req.body || {};
  if (!fileBase64) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
  }

  try {
    // Usando o modelo Gemini 1.5 Flash pela velocidade e excelente extração de dados
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
   const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT + "\n\nAnalise o documento abaixo e responda APENAS com o JSON solicitado, sem markdown:" },
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: fileBase64
              }
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erro na API do Gemini' });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      return res.status(502).json({ error: 'A resposta da IA não veio em JSON válido', raw: rawText.slice(0, 500) });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
