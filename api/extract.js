export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response("Método não permitido", { status: 405 });

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) throw new Error("Arquivo não recebido");

    const textContent = await file.text();

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: `Extraia dados deste texto: ${textContent}` }]
      })
    });

    const data = await response.json();

    // AQUI ESTÁ A BLINDAGEM: Se a estrutura mudar, ele vai te dizer EXATAMENTE o que veio
    if (!data.choices || data.choices.length === 0) {
      return new Response(JSON.stringify({ error: "Resposta da API inesperada", raw: data }), { status: 500 });
    }

    return new Response(JSON.stringify({ resultado: data.choices[0].message.content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
