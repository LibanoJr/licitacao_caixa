export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    // 1. Consulta a API para descobrir o nome exato do modelo liberado para sua chave
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const listRes = await fetch(listUrl);
    const listData = await listRes.json();

    if (!listData.models) {
      return res.status(500).json({ error: "Sua chave de API é inválida ou está sem permissão de leitura." });
    }

    // 2. Mapeia e seleciona o modelo correto dinamicamente
    const availableModels = listData.models.map(m => m.name);
    let modelName = '';

    if (availableModels.includes('models/gemini-1.5-flash')) {
      modelName = 'models/gemini-1.5-flash';
    } else if (availableModels.includes('models/gemini-1.5-pro')) {
      modelName = 'models/gemini-1.5-pro';
    } else {
      // Se não achar os nomes padrão, pega a primeira variação do 1.5 que o Google listar
      const fallbackModel = availableModels.find(m => m.includes('gemini-1.5'));
      if (!fallbackModel) {
         return res.status(500).json({ error: "Sua chave não possui acesso à família Gemini 1.5. Modelos disponíveis: " + availableModels.join(", ") });
      }
      modelName = fallbackModel;
    }

    // 3. Faz a extração do PDF garantindo o endpoint correto
    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: (SYSTEM_PROMPT || "Extraia as informações do documento:") + "\n\nResponda APENAS com JSON puro, sem formatação markdown e sem crases." },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
          ]
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro retornado pela IA: " + data.error.message });
    }

    // 4. Limpeza e envio do resultado para a tela
    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    
    res.status(200).json(JSON.parse(jsonStr));

  } catch (error) {
    res.status(500).json({ error: "Erro interno de processamento: " + error.message });
  }
}
