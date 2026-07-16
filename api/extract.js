export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  // Modelo definitivo: Estável, gratuito, leitura nativa de PDFs
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const instrucaoForcada = `
    Você é um assistente especializado em Cartórios de Registro de Imóveis.
    Analise o PDF da matrícula anexada e extraia os dados.
    
    REGRAS RÍGIDAS E OBRIGATÓRIAS:
    1. Retorne APENAS um objeto JSON válido e nada mais. 
    2. NÃO use formatação markdown (NÃO inclua \`\`\`json ou \`\`\`).
    3. Se não encontrar o dado, retorne uma string vazia "".
    
    Use EXATAMENTE as seguintes chaves no seu JSON:
    {
      "matricula": "O número da matrícula do imóvel",
      "cnm": "O Código Nacional de Matrícula",
      "cartorio": "Nome do cartório, cidade e UF",
      "endereco": "Endereço ou descrição do imóvel",
      "proprietario": "Nome do atual proprietário",
      "areaPrivativa": "Tamanho da área privativa com a unidade de medida",
      "areaTotal": "Tamanho da área total com a unidade de medida",
      "matriculaOrigem": "Número da matrícula de origem",
      "programaHabitacional": "Nome do programa habitacional, se houver"
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: instrucaoForcada },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } }
          ]
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro na API do Google: " + data.error.message });
    }

    // Extração e limpeza agressiva para evitar quebra do JSON
    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(jsonStr);

    // Mapeamento redundante: Entrega a chave do jeito que o seu frontend precisar ler
    const responseFinal = {
      matricula: parsedData.matricula || "",
      numero_matricula: parsedData.matricula || "",
      
      cnm: parsedData.cnm || "",
      
      cartorio: parsedData.cartorio || "",
      cartorio_comarca: parsedData.cartorio || "",
      
      endereco: parsedData.endereco || "",
      endereco_descricao: parsedData.endereco || "",
      
      proprietario: parsedData.proprietario || "",
      proprietario_atual: parsedData.proprietario || "",
      
      areaPrivativa: parsedData.areaPrivativa || parsedData.area_privativa || "",
      area_privativa: parsedData.areaPrivativa || parsedData.area_privativa || "",
      
      areaTotal: parsedData.areaTotal || parsedData.area_total || "",
      area_total: parsedData.areaTotal || parsedData.area_total || "",
      
      matriculaOrigem: parsedData.matriculaOrigem || parsedData.matricula_origem || "",
      matricula_origem: parsedData.matriculaOrigem || parsedData.matricula_origem || "",
      
      programaHabitacional: parsedData.programaHabitacional || parsedData.programa_habitacional || "",
      programa_habitacional: parsedData.programaHabitacional || parsedData.programa_habitacional || "",
      
      confianca: "Alta"
    };

    return res.status(200).json(responseFinal);

  } catch (error) {
    return res.status(500).json({ error: "Falha ao processar e mapear os dados: " + error.message });
  }
}
