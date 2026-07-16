/**
 * Arquivo: api/extract.js
 * Descrição: Código corrigido e blindado contra erros de padrão de string na leitura de PDFs.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

// Inicializa a API do Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Converte de forma segura o PDF em Base64 purificado, removendo qualquer quebra de padrão
 */
function fileToGenerativePart(caminhoAbsoluto, mimeType) {
  try {
    // Leitura síncrona do arquivo
    const arquivoBuffer = fs.readFileSync(caminhoAbsoluto);
    
    // Converte para base64 limpando espaços ou caracteres residuais
    const base64Dados = arquivoBuffer.toString("base64").trim();

    return {
      inlineData: {
        data: base64Dados,
        mimeType: mimeType
      },
    };
  } catch (erroLeitura) {
    console.error("[Erro na Leitura Física do Arquivo]:", erroLeitura);
    throw new Error(`Não foi possível ler o arquivo no caminho especificado. Verifique se ele existe.`);
  }
}

/**
 * Função principal de extração
 */
async function processarEExtrairPDF(caminhoDoPdf, promptExtracao) {
  try {
    // Resolve o caminho do arquivo para garantir que seja um caminho absoluto válido no sistema
    const caminhoResolvido = path.resolve(caminhoDoPdf);
    
    // Gera a part com os dados limpos
    const pdfPart = fileToGenerativePart(caminhoResolvido, "application/pdf");

    // Instancia o modelo estável
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Envia para a API do Google
    const result = await model.generateContent([pdfPart, promptExtracao]);
    const response = await result.response;
    
    return response.text();

  } catch (error) {
    // Captura o erro exato e trata a mensagem do "expected pattern"
    if (error.message && error.message.includes("pattern")) {
      console.error("[Erro de Padrão]: O formato da string enviada para o Gemini falhou.");
    }
    console.error("[Erro Geral na API]:", error);
    throw error;
  }
}

module.exports = {
  processarEExtrairPDF
};
