export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY; // Chave do OpenRouter (sk-or-...)

  try {
    // 1. Consulta o OpenRouter para descobrir quais modelos gratuitos do Gemini estão disponíveis hoje
    const listRes = await fetch("https://openrouter.ai/api/v1/models");
    const listData = await listRes.json();

    if (!listData.data) {
      return res.status(500).json({ error: "Não foi possível listar os modelos do OpenRouter. Verifique sua chave." });
    }

    // Filtra para encontrar qualquer modelo do Gemini que seja gratuito (:free) ou o Flash padrão
    const availableModels = listData.data.map(m => m.id);
    
    // Busca na lista na seguinte ordem de preferência:
    let chosenModel = availableModels.find(id => id === "google/gemini-2.5-flash:free") ||
                      availableModels.find(id => id === "google/gemini-2.0-flash:free") ||
                      availableModels.find(id => id.includes("google/gemini") && id.includes(":free")) ||
                      availableModels.find(id => id.includes("google/gemini-2.5-flash")) ||
                      "google/gemini-2.0-flash-lite"; // Último recurso caso falhe a busca

    const url = "https://openrouter.ai/api/v1/chat/completions";

    const instrucaoForcada = `
      Você é um extrator de dados de PDFs de matrículas de imóveis.
      Extraia as informações do documento e retorne APENAS um objeto JSON plano (sem formatação markdown, sem crases, sem texto adicional).
      
      Use EXATAMENTE estas chaves no JSON (se não encontrar o dado, retorne "" para a chave):
      {
        "matricula": "número da matrícula encontrado no topo/início do documento",
        "cnm": "Código Nacional de Matrícula (CNM)",
        "cartorio": "Nome do cartório, comarca e estado",
        "endereco": "Endereço completo ou descrição do imóvel",
        "proprietario": "Nome do proprietário atual ou adquirente",
        "areaPrivativa": "Área privativa (se houver, ex: 65m²)",
        "areaTotal": "Área total do imóvel",
        "matriculaOrigem": "Número da matrícula ou transcrição de origem",
        "programaHabitacional": "Informação se faz parte de programa habitacional (ex: Minha Casa Minha Vida, COHAB, etc)"
      }

      Contexto adicional de instruções do usuário:
      ${SYSTEM_PROMPT || ""}
    `;

    // 2. Faz a chamada com o modelo selecionado dinamicamente
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vercel.com',
        'X-Title': 'Extrator de Matriculas'
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instrucaoForcada },
              {
                type: "image_url",
                image_url: {
                  url: `data:application/pdf;base64,${fileBase64}`
                }
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro no OpenRouter: " + data.error.message });
    }

    const text = data.choices[0].message.content;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    
    res.status(200).json(JSON.parse(jsonStr));

  } catch (error) {
    res.status(500).json({ error: "Falha ao processar dados: " + error.message });
  }
}
