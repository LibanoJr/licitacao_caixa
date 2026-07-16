export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response("Método não permitido", { status: 405 });

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    
    // A Groq não aceita arquivos diretamente como o Google. 
    // Como estamos em um ambiente limitado (Edge), vamos extrair o texto de forma simples.
    // Se o PDF for um texto comum, o código abaixo processa.
    const textContent = await file.text(); 

    const requestBody = {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Extraia os dados em JSON." },
        { role: "user", content: `Analise este conteúdo e extraia os dados estruturados: ${textContent}` }
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
    
    // CORREÇÃO DA ESTRUTURA GROQ: 
    // A resposta fica dentro de choices[0].message.content
    const resultado = data.choices[0].message.content;

    return new Response(JSON.stringify({ resultado }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
