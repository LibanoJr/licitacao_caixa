export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SYSTEM_PROMPT + "\n\nResponda APENAS com JSON puro sem markdown." },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
          ]
        }]
      })
    });

    const data = await response.json();

    // Debug: Se a estrutura de candidatos não existir, retorna o erro completo da API
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      return res.status(500).json({ error: "Resposta inesperada da API: " + JSON.stringify(data) });
    }

    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    res.status(200).json(JSON.parse(jsonStr));
    
  } catch (error) {
    res.status(500).json({ error: "Erro crítico: " + error.message });
  }
}
