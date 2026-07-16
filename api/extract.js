import pdfParse from 'pdf-parse';

export const config = { runtime: 'nodejs' }; // Mudamos para nodejs para usar o pdf-parse

export default async function handler(req, res) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Extrai o texto do PDF
    const pdfData = await pdfParse(buffer);
    const textoExtraido = pdfData.text;

    // 2. Envia apenas o texto para a IA
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: `Analise este conteúdo de matrícula e extraia os dados em JSON: ${textoExtraido}` }]
      })
    });

    const data = await response.json();
    const resultado = data.choices[0].message.content;

    return new Response(JSON.stringify({ resultado }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
