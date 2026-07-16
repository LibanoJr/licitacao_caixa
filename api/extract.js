export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY; // Chave do Google AI Studio (AIzaSy...)

  // Usando o Gemini 3.1 Flash Lite, ativo na sua conta e totalmente gratuito para leitura de arquivos
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

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

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: instrucaoForcada },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
          ]
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro na API do Google: " + data.error.message });
    }

    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    
    res.status(200).json(JSON.parse(jsonStr));

  } catch (error) {
    res.status(500).json({ error: "Falha ao processar dados: " + error.message });
  }
}
