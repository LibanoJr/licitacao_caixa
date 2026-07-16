/**
 * Arquivo: api/extract.js
 * Descrição: Manipulador de API nativo para ambiente Web/Edge (sem dependências externas)
 */

export const config = {
  runtime: 'edge', // Garante a compatibilidade se estiver na Vercel
};

/**
 * Função principal que o seu index.html chama via requisição
 */
export default async function handler(req) {
  // 1. Valida se o método é POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 2. Recupera o arquivo enviado via FormData (do seu formulário no index.html)
    const formData = await req.formData();
    const file = formData.get('file'); // O input do arquivo deve ter o name="file"
    const promptText = formData.get('prompt') || 'Extraia os dados deste PDF em formato JSON.';

    if (!file) {
      return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Converte o PDF recebido diretamente para a string Base64 limpa
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    // 4. Monta o corpo da requisição exatamente no padrão esperado pelo Gemini 1.5 Flash
    const requestBody = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: base64Data
              }
            },
            {
              text: promptText
            }
          ]
        }
      ]
    };

    const apiKey = process.env.GEMINI_API_KEY;
    
    // 5. Chamada HTTP direta usando o endpoint v1beta com o modelo ESTÁVEL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Falha na comunicação com o Gemini');
    }

    const data = await response.json();
    
    // Retorna o texto extraído de volta para a sua interface html
    const textoExtraido = data.candidates[0].content.parts[0].text;

    return new Response(JSON.stringify({ resultado: textoExtraido }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Erro na API]:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
