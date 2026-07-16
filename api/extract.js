/**
 * Arquivo: api/extract.js
 * Descrição: Script completo e corrigido para extração de dados de PDFs usando o Gemini 1.5 Flash.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

// Inicializa a API do Gemini puxando a chave da variável de ambiente
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Converte um arquivo local no formato binário base64 exigido pelo SDK do Gemini
 */
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

/**
 * Função principal do pipeline que faz a extração dos dados do PDF
 * @param {string} caminhoPdf - Caminho do arquivo PDF local
 * @param {string} promptExtracao - O prompt de comando estruturado
 */
async function processarEExtrairPDF(caminhoPdf, promptExtracao) {
  console.log(`[Status] Lendo arquivo PDF: ${caminhoPdf}...`);
  
  try {
    // 1. Prepara o arquivo PDF convertido
    const pdfPart = fileToGenerativePart(caminhoPdf, "application/pdf");

    // 2. CORREÇÃO DEFINITIVA: Usando a string estável e homologada 'gemini-1.5-flash'
    // Sem prefixos ou sufixos que quebram o endpoint v1beta
    console.log("[Status] Inicializando o modelo estável gemini-1.5-flash...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 3. Executa a chamada enviando o arquivo estruturado + o prompt
    console.log("[Status] Processando documento e extraindo informações...");
    const result = await model.generateContent([pdfPart, promptExtracao]);
    
    // 4. Retorna o resultado final (geralmente o JSON com os dados do PDF)
    const response = await result.response;
    const textoExtraido = response.text();
    
    console.log("[Status] Extração finalizada com sucesso!");
    return textoExtraido;

  } catch (error) {
    console.error("[Erro] Falha catastrófica no processo de extração:", error);
    throw error;
  }
}

// Exporta a função para o seu index.html e servidor utilizarem
module.exports = {
  processarEExtrairPDF
};
