export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    
    // Convertemos o arquivo para uma string base64, que é a forma 
    // universal de enviar qualquer tipo de arquivo para IAs
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ 
          role: "user", 
          content: `Analise o arquivo enviado (base64): ${base64.substring(0, 5000)}. Extraia os dados em JSON.` 
        }]
      })
    });

    const data = await response.json();
    
    // Verificamos se a resposta existe antes de tentar acessar
    const texto = data.choices?.[0]?.message?.content;
    
    if (!texto) {
      return new Response(JSON.stringify({ error: "IA não retornou dados. Resposta: " + JSON.stringify(data) }), { status: 500 });
    }

    return new Response(JSON.stringify({ resultado: texto }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
