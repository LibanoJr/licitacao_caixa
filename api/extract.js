export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64, SYSTEM_PROMPT } = req.body;
  const apiKey = process.env.GEMINI_API_KEY; // Sua chave da Groq (gsk_...) cadastrada na Vercel

  const url = "https://api.groq.com/openai/v1/chat/completions";

  // Extração básica de texto do Base64 do PDF
  let textoExtraido = "";
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    textoExtraido = buffer.toString('utf-8').replace(/[^\x20-\x7E\s]/g, '');
  } catch (e) {
    textoExtraido = "Falha ao extrair texto direto.";
  }

  const instrucaoForcada = `
    Você é um extrator de dados especialista em documentos de registro de imóveis.
    Analise o texto extraído do PDF da matrícula e organize as informações solicitadas.
    
    Responda APENAS com um objeto JSON plano válido (sem formatação markdown, sem blocos de código com crases, sem texto explicativo).
    
    Estrutura obrigatória do JSON (valores vazios devem retornar "" se não encontrados):
    {
      "matricula": "Número de identificação da matrícula encontrado no topo ou no início do documento",
      "cnm": "Código Nacional de Matrícula (CNM)",
      "cartorio": "Nome completo do cartório, comarca e estado",
      "endereco": "Endereço completo ou descrição física detalhada do imóvel",
      "proprietario": "Nome completo do proprietário atual ou adquirente final",
      "areaPrivativa": "Área privativa (ex: 65,40 m²)",
      "areaTotal": "Área total do imóvel",
      "matriculaOrigem": "Número da matrícula ou transcrição de origem",
      "programaHabitacional": "Informações de programas de moradia se houver"
    }

    Texto bruto extraído do PDF:
    ---
    ${textoExtraido}
    ---

    Contexto adicional de instruções do usuário:
    ${SYSTEM_PROMPT || ""}
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: instrucaoForcada
          }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Erro na API Groq: " + data.error.message });
    }

    const text = data.choices[0].message.content.trim();
    const jsonStr = text.replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(jsonStr);

    const responseMapeada = {
      matricula: parsedData.matricula || "",
      numeroMatricula: parsedData.matricula || "",
      numero_matricula: parsedData.matricula || "",
      cnm: parsedData.cnm || "",
      cartorio: parsedData.cartorio || "",
      cartorio_comarca: parsedData.cartorio || "",
      cartorioComarca: parsedData.cartorio || "",
      endereco: parsedData.endereco || "",
      endereco_descricao: parsedData.endereco || "",
      enderecoDescricao: parsedData.endereco || "",
      proprietario: parsedData.proprietario || "",
      proprietario_atual: parsedData.proprietario || "",
      proprietarioAtual: parsedData.proprietario || "",
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

    res.status(200).json(responseMapeada);

  } catch (error) {
    res.status(500).json({ error: "Falha ao processar dados com Groq: " + error.message });
  }
}
