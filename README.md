# Precificação automatizada de imóveis — CR 12/2026-5688 CAIXA (GEHPA)

MVP que lê a Certidão de Inteiro Teor (matrícula) em PDF, extrai os dados com IA, calcula um valor estimado ou recusa a ordem de serviço com fundamentação (item 9.5 do Anexo I), registra tudo para auditoria e emite o Relatório de Precificação em PDF.

## Páginas e endpoints

| Caminho | O que faz |
|---|---|
| `/teste-precificacao.html` | Fluxo completo: envia o PDF, mostra valor ou recusa, motivos de revisão, elegibilidade, tempo de atendimento, responsáveis técnicos, link do PDF e correção manual com recálculo |
| `/` (`index.html`) | Extração em lote com correção campo a campo e exportação CSV (base de acurácia da extração) |
| `POST /api/extract` | Lê o PDF com Gemini e devolve JSON estruturado |
| `POST /api/price` | Precifica a partir do JSON extraído (ou corrigido); devolve estimativa ou recusa e grava o histórico |
| `GET /api/relatorio-pdf?id=N` | Relatório de Precificação em PDF de um registro |
| `GET /api/historico` | Lista registros (`?formato=csv`, `?cidade=`, `?revisao=true`, `?limite=`) |
| `POST /api/registrar-avaliacao` | Fluxo pareado: grava o valor da avaliação NBR 14653 de um registro |
| `GET /api/fluxo-pareado` | Fluxo pareado: MAPE, viés e faixas de desvio (`?cidade=`, `?dias=`) |

Todo o site fica atrás de usuário e senha (`middleware.js`).

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Obrigatória | Para quê |
|---|---|---|
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | sim | Login do site inteiro |
| `GEMINI_API_KEY` | sim | Extração. **Use chave de projeto com faturamento ativo (tier pago)** — no tier gratuito o Google pode usar os documentos enviados para treinar modelos, incompatível com matrícula real (LGPD) |
| `APP_ACCESS_KEY` | recomendada | Chave extra exigida pelo `/api/extract` |
| `DATABASE_URL` (ou `STORAGE_DATABASE_URL` da integração Neon) | sim | Histórico, PDF e fluxo pareado |
| `RT_ANALISE_NOME`, `RT_ANALISE_REGISTRO` | **sim, antes de enviar** | RT pela análise das precificações (item 4.6). Aparece em toda resposta e no PDF; sem ela sai "PENDENTE" |
| `RT_EMISSAO_NOME`, `RT_EMISSAO_REGISTRO` | **sim, antes de enviar** | RT pela emissão do relatório (item 4.9) |
| `RT_MODELAGEM_NOME`, `RT_MODELAGEM_REGISTRO` | opcional | RT pela modelagem (padrão: Líbano Abboud Júnior) |
| `GEMINI_MODEL` | opcional | Troca o modelo de extração sem mexer no código (padrão `gemini-3.1-flash-lite`) |
| `LIMITE_DIARIO_GEMINI` | opcional | Teto diário de chamadas ao Gemini |
| `LISTA_DOCUMENTOS_CONFLITO` | opcional | CPF/CNPJ separados por vírgula para recusa por conflito de interesse (motivo c) |

## Banco de dados

Rode `schema.sql` uma vez no SQL Editor do Neon. Ele é idempotente: cria as tabelas se não existirem e só acrescenta colunas que faltarem.

## Publicar

```
git add .
git commit -m "MVP 1.1: SP por bairro, recusa na tela, PDF, correção manual, área com milhar"
git push
```

A Vercel faz o redeploy sozinha. Depois do deploy, teste em `/teste-precificacao.html` com uma matrícula de São Paulo (deve sair valor por bairro), uma de cidade não atendida (deve sair recusa com motivo) e abra o PDF.

## Metodologia (versão 1.1.0-baseline)

Valor = área × preço/m² de referência da região × fatores de ajuste fixos. Não é modelo estatístico treinado; o contrato do endpoint não muda quando for.

- **São Paulo/SP (capital)**: mediana do preço pedido por m² de apartamentos à venda por bairro, edição outubro/2026 de *A Corrida dos Bairros* (45.870 anúncios). Bairros com menos de 20 anúncios ou não reconhecidos no endereço vão para revisão manual; bairro não reconhecido usa a mediana da cidade (R$ 9.475/m²). São preços de oferta, não de transação. Atualizar mensalmente.
- **Brasília/DF e Cidade Ocidental/GO**: tabela por região (parte dos valores ainda é placeholder e vai para revisão).
- **Recusa (item 9.5)**: (a) sem área ou cidade sem preço configurado; (b) área privativa maior que a total; (c) documento na lista de conflito; (d) cidade não identificada.
- **Elegibilidade SP** (carta CAIXA GEHPA de 07/09/2026): apartamento, 35–250 m², até R$ 2,25 mi, até 20 anos. Fora do critério vai para revisão; não é motivo de recusa.
- Toda estimativa traz `motivos_revisao` explicando por que precisa (ou não) de revisão manual.

## Histórico de versões do modelo

- **1.1.1-baseline (02/10/2026)**: prompt de extração define cada tipo de área (privativa/útil, comum, total da unidade, construída, terreno) e pede o trecho de onde a área foi lida; casas usam área construída; área do terreno nunca é base do cálculo; tela mostra todas as áreas extraídas.
- **1.1.0-baseline (02/10/2026)**: São Paulo por bairro (antes toda matrícula de SP era recusada); leitura de área com separador de milhar ("1.200" era lido como 1,2 m²); cidade pelo cartório quando só há a UF ("do DF", "da Capital - SP"); motivos de revisão explícitos; recusa exibida na tela (antes quebrava a página); correção manual com recálculo; PDF com quebra de linha, recusa, motivos e RTs; RTs por variável de ambiente; fluxo pareado ignora recusas; dependências com versão fixa.
- **1.0.0-baseline (24/08/2026)**: versão inicial.

## Limites conhecidos

- Preços de São Paulo vêm de anúncios: tendem a ficar acima do valor de transação. O fluxo pareado (`/api/fluxo-pareado`) é o que vai medir esse viés; se ele se confirmar, aplicar fator de oferta.
- Bairros periféricos de SP fora da tabela caem na mediana da cidade, que tende a superestimar. Sempre vão para revisão.
- O casamento de bairro é por texto no endereço; nomes genéricos (Centro, Liberdade, Paraíso, Bela Vista, Brás, Penha) ficaram de fora de propósito para não casar errado.
- Plano Hobby da Vercel limita o corpo da requisição a ~4,5 MB; PDFs maiores falham na extração.
