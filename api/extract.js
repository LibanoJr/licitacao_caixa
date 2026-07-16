export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64 } = req.body;
  
  if (!fileBase64) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // URL corrigida com o sufixo "-latest", exigido pela API v1beta do Google
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

  const instrucaoForcada = `
    Você é um sistema de extração de dados de matrículas de imóveis.
    Analise o PDF anexado e retorne APENAS um objeto JSON. 
    Não escreva mais nada, não use markdown e não inclua crases (\`\`\`).
    
    O JSON DEVE ter exatamente estas chaves (se não achar o dado, retorne ""):
    {
      "matricula": "Número da matrícula do imóvel",
      "cnm": "Código Nacional de Matrícula (CNM)",
      "cartorio": "Nome do cartório e comarca",
      "endereco": "Endereço completo do imóvel",
      "proprietario": "Nome do atual proprietário",
      "areaPrivativa": "Área privativa",
      "areaTotal": "Área total",
      "matriculaOrigem": "Número da matrícula de origem",
      "programaHabitacional": "Nome do programa habitacional, se houver"
    }
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

    // Tratamento rigoroso de erro do Google para você saber exatamente se falhar
    if (!response.ok || data.error) {
      return res.status(500).json({ error: data.error?.message || "Erro na comunicação com a API do Gemini." });
    }

    // Pega o texto da resposta, limpa qualquer resquício de markdown e converte para objeto
    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(jsonStr);

    // Retorna exatamente as chaves que foram pedidas no prompt
    return res.status(200).json(parsedData);

  } catch (error) {
    return res.status(500).json({ error: "Erro de processamento no servidor: " + error.message });
  }
}
