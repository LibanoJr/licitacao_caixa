export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');
  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  // gemini-2.5-flash-lite está sendo desativado pelo Google (desligamento em 22/07/2026).
  // Substituto estável recomendado: gemini-3.1-flash-lite
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SYSTEM_PROMPT || "Extraia as informações do documento:" },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
          ]
        }],
        generationConfig: {
          // Força a resposta em JSON puro, sem crases nem texto ao redor —
          // evita boa parte dos erros de parsing.
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro na API do Google: " + data.error.message });
    }

    const candidate = data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;

    if (!text) {
      // Acontece, por exemplo, quando o modelo bloqueia a resposta por safety/finishReason.
      return res.status(502).json({
        error: "A IA não retornou texto. finishReason: " + (candidate && candidate.finishReason),
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
