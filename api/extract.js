export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  // Usamos o gemini-2.5-flash que está ativo na sua chave
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
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
      return res.status(500).json({ error: "Erro na API do Google: " + data.error.message });
    }

    const text = data.candidates[0].content.parts[0].text;
    
    // Remove qualquer marcação markdown de código que a IA possa retornar
    const jsonStr = text.replace(/```json|```/g, '').trim();
    
    res.status(200).json(JSON.parse(jsonStr));

  } catch (error) {
    res.status(500).json({ error: "Falha ao processar dados: " + error.message });
  }
}
