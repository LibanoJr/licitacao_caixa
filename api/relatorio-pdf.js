// api/relatorio-pdf.js
// Gera o Relatório de Precificação em PDF pra um registro específico —
// item 2.3 do Anexo I ("emitir e exportar dados e relatórios ... em .pdf
// e .csv"). CSV em lote: /api/historico?formato=csv. Este endpoint é o
// relatório formal de UM imóvel.
//
// GET /api/relatorio-pdf?id=123
//
// Versão do modelo e responsáveis técnicos são lidos do PRÓPRIO registro
// (precificacao_bruta), não de constantes deste arquivo: assim o PDF de
// uma precificação antiga mostra a versão que realmente a gerou (item
// 20.14, controle de versão) e não há duas cópias pra manter em sincronia.

import { neon } from "@neondatabase/serverless";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const CONNECTION_STRING =
  process.env.STORAGE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.STORAGE_DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const sql = CONNECTION_STRING ? neon(CONNECTION_STRING) : null;

const MARGEM = 50;
const LARGURA_PAGINA = 595; // A4
const ALTURA_PAGINA = 842;
const LARGURA_UTIL = LARGURA_PAGINA - 2 * MARGEM;

function formatarBRL(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor));
}

function lerJson(valor) {
  if (!valor) return {};
  if (typeof valor === "object") return valor;
  try { return JSON.parse(valor); } catch { return {}; }
}

async function gerarPdf(registro) {
  const pdfDoc = await PDFDocument.create();
  const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonteBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const bruta = lerJson(registro.precificacao_bruta);
  const modelo = bruta.modelo || {};
  const rts = bruta.responsaveis_tecnicos || {};
  const recusa = registro.tipo_resposta === "recusa";

  let page = pdfDoc.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
  let y = ALTURA_PAGINA - 60;

  // A fonte padrão (WinAnsi) não codifica todo caractere Unicode — texto
  // vindo da matrícula/LLM pode trazer símbolo fora dela e o pdf-lib
  // lança erro. Troca cada caractere não codificável por "?".
  const cacheCodificavel = new Map();
  // "²" até codifica, mas a Helvetica padrão não tem o glifo e ele sai em
  // branco — por isso vira "2" antes (m² -> m2).
  const seguro = (texto, f) => {
    let saida = "";
    for (const ch of String(texto ?? "").replace(/²/g, "2")) {
      const chave = ch + (f === fonteBold ? "b" : "r");
      if (!cacheCodificavel.has(chave)) {
        try { f.encodeText(ch); cacheCodificavel.set(chave, true); }
        catch { cacheCodificavel.set(chave, false); }
      }
      saida += cacheCodificavel.get(chave) ? ch : "?";
    }
    return saida;
  };

  const quebrar = (texto, f, tamanho) => {
    const palavras = seguro(texto, f).split(/\s+/);
    const linhas = [];
    let atual = "";
    for (const p of palavras) {
      const tentativa = atual ? atual + " " + p : p;
      if (f.widthOfTextAtSize(tentativa, tamanho) <= LARGURA_UTIL) {
        atual = tentativa;
      } else {
        if (atual) linhas.push(atual);
        atual = p;
      }
    }
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [""];
  };

  const linha = (texto, opts = {}) => {
    const tamanho = opts.size || 10.5;
    const f = opts.bold ? fonteBold : fonte;
    const alturaLinha = tamanho * 1.35;
    for (const l of quebrar(texto, f, tamanho)) {
      if (y < 60) {
        page = pdfDoc.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
        y = ALTURA_PAGINA - 60;
      }
      page.drawText(l, { x: MARGEM, y, size: tamanho, font: f, color: opts.color || rgb(0.1, 0.1, 0.1) });
      y -= alturaLinha;
    }
    y -= opts.gapDepois ?? 4;
  };

  const secao = (titulo) => {
    y -= 8;
    linha(titulo, { bold: true, size: 11.5, gapDepois: 6 });
  };

  linha("Relatório de Precificação de Imóvel", { size: 16, bold: true, gapDepois: 2 });
  linha("Credenciamento CR 12/2026-5688 CAIXA (GEHPA)", { size: 10 });
  linha(`Registro nº ${registro.id} · precificado em ${new Date(registro.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · emitido em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, { size: 9, gapDepois: 10 });

  secao("Dados do imóvel");
  linha(`Matrícula: ${registro.numero_matricula || "não informado"}`);
  linha(`Endereço: ${registro.endereco_completo || "não informado"}`);
  linha(`Cidade identificada: ${registro.cidade_identificada || "não identificada"}`);
  linha(`Bairro/região identificado: ${registro.regiao_identificada || "não reconhecido"}`);
  linha(`Área privativa: ${registro.area_privativa_m2 ?? "—"} m²   ·   Área total: ${registro.area_total_m2 ?? "—"} m²`);

  if (recusa) {
    secao("Resultado: ordem de serviço recusada (item 9.5 do Anexo I)");
    linha(`Motivo (${registro.motivo_recusa}): ${bruta.motivo_descricao || ""}`, { bold: true });
    linha(`Fundamentação: ${registro.fundamentacao_recusa || "—"}`);
  } else {
    secao("Resultado da precificação");
    linha(`Valor estimado: ${formatarBRL(registro.valor_estimado)}`, { size: 14, bold: true, gapDepois: 6 });
    const dc = bruta.detalhes_calculo || {};
    linha(`Preço/m² utilizado: ${formatarBRL(registro.preco_m2_utilizado)} (fonte: ${registro.fonte_preco_m2 || "—"}${dc.amostra_anuncios_regiao ? `, ${dc.amostra_anuncios_regiao} anúncios no bairro` : ""})`);
    linha(`Área utilizada: ${dc.area_utilizada_m2 ?? "—"} m² (${dc.origem_area || "—"})`);
    linha(`Fator de ajuste: ×${registro.fator_ajuste ?? "—"}${(dc.ajustes_aplicados || []).length ? " — " + dc.ajustes_aplicados.join("; ") : ""}`);
    linha(`Confiança da extração: ${registro.confianca_extracao || "—"}`);
    linha(`Revisão manual: ${registro.precisa_revisao_manual ? "NECESSÁRIA" : "não necessária"}`, { bold: !!registro.precisa_revisao_manual });
    for (const m of bruta.motivos_revisao || []) linha(`• ${m}`, { size: 9.5 });
    if (bruta.elegibilidade) {
      linha(`Elegibilidade (${bruta.elegibilidade.fonte_criterio}): ${bruta.elegibilidade.dentro_do_criterio ? "dentro do critério" : "fora do critério"}`);
    }
  }

  if (registro.valor_real_avaliado) {
    secao("Fluxo pareado");
    linha(`Valor de avaliação NBR 14653: ${formatarBRL(registro.valor_real_avaliado)} (${registro.fonte_valor_real || "—"})`);
  }

  secao("Responsáveis técnicos e versão do modelo");
  for (const chave of ["modelagem", "analise_mercado_imobiliario", "emissao_relatorio"]) {
    const r = rts[chave];
    if (!r) continue;
    linha(`${r.funcao}: ${r.nome}${r.registro_profissional ? ` (${r.registro_profissional})` : ""}`);
    if (Array.isArray(r.pendencias) && r.pendencias.length) {
      linha(`   PENDENTE: ${r.pendencias.join("; ")}`, { size: 8, color: rgb(0.7, 0.1, 0.1) });
    }
  }
  linha(`Modelo: ${modelo.versao || "—"} (${modelo.data_atualizacao || "—"}) — ${modelo.tipo_modelo || ""}`);

  y -= 10;
  linha(
    "Este relatório reflete um modelo baseline determinístico (tabela de referência de preço/m² por região com ajustes fixos), não um modelo estatístico treinado. Os preços de referência de São Paulo são medianas de preço de oferta (anúncios), não de transação. Ver Relatório do Modelo, Seção 3.1, para a metodologia completa.",
    { size: 8, color: rgb(0.35, 0.35, 0.35) }
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
    res.setHeader("Content-Disposition", `inline; filename="relatorio_precificacao_${id}.pdf"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Erro ao gerar PDF:", err);
    return res.status(500).json({ erro: "Erro interno ao gerar PDF." });
  }
}
