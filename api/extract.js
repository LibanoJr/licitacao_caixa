export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método não permitido');

  const { fileBase64 } = req.body;
  
  if (!fileBase64) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // Modelo definitivo: Estável e leitura nativa de PDFs por visão computacional
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

  const instrucaoForcada = `
    Você é um sistema especialista em análise jurídica e precificação de imóveis para a Caixa Econômica Federal.
    Analise o PDF da matrícula anexada e extraia os dados estritamente no formato JSON solicitado.
    
    REGRAS RÍGIDAS DE SAÍDA:
    1. Retorne APENAS um objeto JSON válido.
    2. NÃO use formatação markdown (NÃO inclua \`\`\`json ou \`\`\`).
    3. Se não encontrar um campo textual, retorne "". Para booleanos, false. Para arrays, [].
    
    ESTRUTURA EXATA DO JSON (Respeite rigorosamente esses nomes de chaves):
    {
      "numero_matricula": "Número da matrícula do imóvel",
      "tipo_imovel": "Ex: Apartamento, Casa, Terreno",
      "imovel_pertence_caixa": true ou false (true se a Caixa Econômica Federal for a proprietária atual ou se consolidou a propriedade por alienação fiduciária),
      "cnm": "Código Nacional de Matrícula se houver",
      "cartorio_nome": "Nome oficial do Cartório de Registro de Imóveis",
      "comarca_uf": "Cidade e Estado do cartório (Ex: Brasília - DF)",
      "endereco_completo": "Endereço completo e descrição física do imóvel contida no texto",
      "proprietario_atual_nome": "Nome completo do atual proprietário",
      "proprietario_atual_documento": "CPF ou CNPJ do proprietário atual",
      "area_privativa_m2": "Área privativa (Ex: 65,40 m²)",
      "area_total_m2": "Área total do imóvel",
      "matricula_origem": "Número da matrícula ou transcrição de origem",
      "programa_habitacional": "Nome de programa habitacional se mencionado (Ex: Minha Casa Minha Vida, SH), caso contrário \\"\\"",
      "historico_atos_relevantes": [
        {
          "codigo": "Ex: R.1, AV.2",
          "data": "DD/MM/AAAA",
          "tipo": "Ex: Compra e Venda, Alienação Fiduciária, Penhora",
          "resumo": "Breve resumo do ato político/jurídico ocorrido"
        }
      ],
      "valores_mencionados": [
        {
          "tipo": "Ex: Valor de Compra, Valor da Garantia, Avaliação Fiscal",
          "valor": "R$ X.XXX,XX"
        }
      ],
      "onus_ativos": [
        "Descreva aqui de forma textual quaisquer ônus, gravames, hipotecas, penhoras ou alienações fiduciárias que continuem ativos ou não cancelados"
      ],
      "onus_cancelados": [
        "Descreva os ônus que possuem averbação explícita de cancelamento ou baixa"
      ],
      "alertas": [
        "Gere strings com alertas importantes para precificação (Ex: Existe penhora trabalhista ativa, Área total diverge da privativa, Registro de usufruto vidual)"
      ],
      "confianca_extracao": "Alta"
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

    if (!response.ok || data.error) {
      return res.status(500).json({ error: data.error?.message || "Erro de resposta da API do Gemini." });
    }

    const text = data.candidates[0].content.parts[0].text;
    
    // Limpeza radical de markdown para evitar falhas no JSON.parse
    const jsonStr = text.replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(jsonStr);

    // Garante que estruturas internas de listas venham como Arrays caso a IA falhe
    if (!Array.isArray(parsedData.historico_atos_relevantes)) parsedData.historico_atos_relevantes = [];
    if (!Array.isArray(parsedData.valores_mencionados)) parsedData.valores_mencionados = [];
    if (!Array.isArray(parsedData.onus_ativos)) parsedData.onus_ativos = [];
    if (!Array.isArray(parsedData.onus_cancelados)) parsedData.onus_cancelados = [];
    if (!Array.isArray(parsedData.alertas)) parsedData.alertas = [];

    return res.status(200).json(parsedData);

  } catch (error) {
    return res.status(500).json({ error: "Falha de processamento no servidor backend: " + error.message });
  }
}
