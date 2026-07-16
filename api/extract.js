export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const textContent = await file.text();

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: `Extraia dados: ${textContent.substring(0, 2000)}` }]
      })
    });

    // AQUI ESTÁ O SEGREDO: Vamos ler como texto, não como JSON
    const respostaBruta = await response.text();
    
    // Se não for JSON (começar com <), vamos exibir o texto bruto para saber o que é
    return new Response(JSON.stringify({ 
      status: response.status,
      conteudo: respostaBruta.substring(0, 500) // Mostra os primeiros 500 caracteres
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
