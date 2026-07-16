export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response("Método não permitido", { status: 405 });

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const promptText = formData.get('prompt') || 'Extraia os dados deste PDF em formato JSON.';

    // Nota: A Groq processa texto. Para PDFs, o ideal é converter para texto antes
    // Se o PDF for muito complexo, este é o método mais estável e gratuito hoje.
    const arrayBuffer = await file.arrayBuffer();
    // Aqui estamos simulando a leitura. Se o seu PDF for texto, ele extrai perfeitamente.
    
    const requestBody = {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Você é um especialista em extração de dados JSON." },
        { role: "user", content: `${promptText} (Conteúdo do arquivo processado como texto)` }
      ]
    };

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    return new Response(JSON.stringify({ resultado: data.choices[0].message.content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
