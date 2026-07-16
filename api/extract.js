/**
 * Arquivo: api/extract.js
 * Descrição: Script de diagnóstico para listar os modelos reais disponíveis no endpoint v1beta.
 */

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    
    // Endpoint oficial do Google para listar os modelos válidos da sua chave
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    // Filtra apenas os nomes dos modelos que aceitam gerar conteúdo
    const modelosDisponiveis = data.models
      ? data.models
          .filter(m => m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name)
      : ["Nenhum modelo encontrado ou erro na chave API"];

    return new Response(JSON.stringify({ resultado: modelosDisponiveis }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
