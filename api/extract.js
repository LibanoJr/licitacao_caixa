export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data); // Isso vai listar os modelos disponíveis na sua tela
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
