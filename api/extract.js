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
        messages: [{ role: "user", content: `Extraia os dados em JSON deste conteúdo: ${textContent}` }]
      })
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
