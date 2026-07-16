/**
 * Arquivo: api/extract.js
 * Descrição: Script final configurado para o modelo gemini-2.0-flash
 */

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const promptText = formData.get('prompt') || 'Extraia os dados deste PDF em formato JSON.';

    if (!file) {
      return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado.' }), { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const requestBody = {
      contents: [{
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
          { text: promptText }
        ]
      }]
    };

    const apiKey = process.env.GEMINI_API_KEY;
    
    // A CORREÇÃO DEFINITIVA: Usando o modelo validado na sua lista
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Falha na comunicação com o Gemini');
    }

    const data = await response.json();
    const textoExtraido = data.candidates[0].content.parts[0].text;

    return new Response(JSON.stringify({ resultado: textoExtraido }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
