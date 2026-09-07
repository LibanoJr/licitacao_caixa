// api/relatorio-pdf.js
// Gera o Relatório de Precificação em PDF pra um registro específico —
// item 2.3 do Anexo I: "permitindo emitir e exportar dados e relatórios
// ... em .pdf e .csv". CSV já é coberto pelo /api/historico?formato=csv;
// este endpoint cobre a parte de .pdf, no nível de UM imóvel específico
// (o CSV é melhor pra exportação em lote, o PDF é o "relatório" formal
// por imóvel).
//
// GET /api/relatorio-pdf?id=123

import { neon } from "@neondatabase/serverless";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const CONNECTION_STRING =
  process.env.STORAGE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.STORAGE_DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const sql = CONNECTION_STRING ? neon(CONNECTION_STRING) : null;

// Mesmos metadados usados no price.js — mantidos em sincronia manual por
// enquanto (os dois arquivos são pequenos; se crescer, vale extrair pra
// um módulo compartilhado).
const METADADOS_MODELO = {
  versao: "1.0.0-baseline",
  data_atualizacao: "2026-08-24",
};
const RESPONSAVEL_MODELAGEM = "Líbano Abboud Júnior";

// pdf-lib com a fonte padrão (WinAnsiEncoding) não tem o glyph de "²"
// (superscript two) — vira espaço em branco no PDF final. "m2" com dois
// normal é o workaround, mesmo princípio documentado pra reportlab em
// Python, problema idêntico em fonte padrão de outra biblioteca.
function semSuperscript(texto) {
  return (texto || "").replace(/m²/g, "m2").replace(/²/g, "2");
}

function formatarBRL(valor) {
  if (valor === null || valor === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

async function gerarPdf(registro) {
  const pdfDoc = await PDFDocument.create();
  const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonteBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595, 842]); // A4
  const { height } = page.getSize();
  let y = height - 60;

  const linha = (texto, opts = {}) => {
    page.drawText(semSuperscript(texto), {
      x: 50,
      y,
      size: opts.size || 11,
      font: opts.bold ? fonteBold : fonte,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= opts.gap || 20;
  };

  linha("RELATÓRIO DE PRECIFICAÇÃO DE IMÓVEL", { size: 16, bold: true, gap: 26 });
  linha("Credenciamento CR 12/2026-5688 CAIXA (GEHPA)", { size: 10, gap: 10 });
  linha(`Registro nº ${registro.id} — gerado em ${new Date().toLocaleString("pt-BR")}`, { size: 9, gap: 26 });

  linha("DADOS DO IMÓVEL", { bold: true, gap: 18 });
  linha(`Matrícula: ${registro.numero_matricula || "não informado"}`);
  linha(`Endereço: ${registro.endereco_completo || "não informado"}`);
  linha(`Cidade/região identificada: ${registro.cidade_identificada || "não identificada"}`);
  linha(`Área privativa: ${registro.area_privativa_m2 ?? "—"} m2`, { gap: 26 });

  linha("RESULTADO DA PRECIFICAÇÃO", { bold: true, gap: 18 });
  linha(`Valor estimado: ${formatarBRL(registro.valor_estimado)}`, { size: 14, bold: true, gap: 22 });
  linha(`Preço/m2 utilizado: ${formatarBRL(registro.preco_m2_utilizado)} (fonte: ${registro.fonte_preco_m2 || "—"})`);
  linha(`Fator de ajuste aplicado: ×${registro.fator_ajuste ?? "—"}`);
  linha(`Confiança da extração: ${registro.confianca_extracao || "—"}`);
  linha(`Precisa revisão manual: ${registro.precisa_revisao_manual ? "SIM" : "não"}`, { gap: 26 });

  linha("RESPONSÁVEL TÉCNICO E VERSÃO DO MODELO", { bold: true, gap: 18 });
  linha(`Modelagem: ${RESPONSAVEL_MODELAGEM}`);
  linha(`Versão do modelo: ${METADADOS_MODELO.versao} (${METADADOS_MODELO.data_atualizacao})`, { gap: 26 });

  linha(
    "Este relatório reflete um modelo baseline determinístico (não estatístico treinado) — ver Relatório do Modelo, Seção 3.1, para metodologia completa.",
    { size: 8, gap: 12 }
  );

  return pdfDoc.save();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido. Use GET." });
  }

  if (!sql) {
    return res.status(500).json({ erro: "Variável de conexão do banco não configurada no servidor." });
  }

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ erro: "Parâmetro 'id' ausente ou inválido. Use /api/relatorio-pdf?id=123." });
  }

  try {
    const resultado = await sql`SELECT * FROM precificacoes WHERE id = ${id}`;
    if (resultado.length === 0) {
      return res.status(404).json({ erro: `Nenhum registro encontrado com id ${id}.` });
    }

    const pdfBytes = await gerarPdf(resultado[0]);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="relatorio_precificacao_${id}.pdf"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Erro ao gerar PDF:", err);
    return res.status(500).json({ erro: "Erro interno ao gerar PDF." });
  }
}