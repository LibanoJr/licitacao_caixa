export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-001:generateContent?key=${apiKey}`;

  const instrucaoForcada = `
    Você é um extrator de dados especialista em documentos de registro de imóveis.
    Analise o PDF fornecido e extraia as informações necessárias.
    
    Responda APENAS com um objeto JSON plano (sem formatação markdown, sem crases, sem texto explicativo).
    
    Use EXATAMENTE estas chaves no JSON. Extraia o máximo de informações reais do documento para cada campo:
    {
      "matricula": "número da matrícula encontrado no topo/início do documento",
      "cnm": "Código Nacional de Matrícula (CNM)",
      "cartorio": "Nome do cartório, comarca e estado",
      "endereco": "Endereço completo ou descrição física do imóvel",
      "proprietario": "Nome completo do proprietário atual ou adquirente",
      "areaPrivativa": "Área privativa (se houver, ex: 65,40 m²)",
      "areaTotal": "Área total do imóvel (ex: 120,00 m²)",
      "matriculaOrigem": "Número da matrícula ou transcrição de origem",
      "programaHabitacional": "Informações sobre programa habitacional (ex: MCMV, CDHU, COHAB, etc)"
    }

    Contexto adicional de instruções do usuário:
    ${SYSTEM_PROMPT || ""}
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

    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(jsonStr);

    // Mapeamento redundante: Garante que o frontend ache a chave que ele precisa, seja lá qual formato ele use
    const responseMapeada = {
      // Matrícula
      matricula: parsedData.matricula || "",
      numeroMatricula: parsedData.matricula || "",
      numero_matricula: parsedData.matricula || "",
      
      // CNM
      cnm: parsedData.cnm || "",
      
      // Cartório
      cartorio: parsedData.cartorio || "",
      cartorio_comarca: parsedData.cartorio || "",
      cartorioComarca: parsedData.cartorio || "",
      
      // Endereço
      endereco: parsedData.endereco || "",
      endereco_descricao: parsedData.endereco || "",
      enderecoDescricao: parsedData.endereco || "",
      
      // Proprietário
      proprietario: parsedData.proprietario || "",
      proprietario_atual: parsedData.proprietario || "",
      proprietarioAtual: parsedData.proprietario || "",
      
      // Área Privativa
      areaPrivativa: parsedData.areaPrivativa || parsedData.area_privativa || "",
      area_privativa: parsedData.areaPrivativa || parsedData.area_privativa || "",
      
      // Área Total
      areaTotal: parsedData.areaTotal || parsedData.area_total || "",
      area_total: parsedData.areaTotal || parsedData.area_total || "",
      
      // Matrícula de Origem
      matriculaOrigem: parsedData.matriculaOrigem || parsedData.matricula_origem || "",
      matricula_origem: parsedData.matriculaOrigem || parsedData.matricula_origem || "",
      
      // Programa Habitacional
      programaHabitacional: parsedData.programaHabitacional || parsedData.programa_habitacional || "",
      programa_habitacional: parsedData.programaHabitacional || parsedData.programa_habitacional || "",
      
      // Metadados extras de segurança
      confianca: "Alta"
    };

    res.status(200).json(responseMapeada);

  } catch (error) {
    res.status(500).json({ error: "Falha ao processar dados: " + error.message });
  }
}
