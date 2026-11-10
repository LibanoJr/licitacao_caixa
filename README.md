# Precificação automatizada de imóveis — CR 12/2026-5688 CAIXA (GEHPA)

Sistema que lê a Certidão de Inteiro Teor (matrícula) em PDF, extrai os dados
com IA, calcula um valor estimado ou recusa a ordem de serviço com motivo
(item 9.5 do Anexo I), registra tudo para auditoria e emite o Relatório de
Precificação em PDF.

Escopo: apartamentos no município de São Paulo/SP.

## Páginas e endpoints

| Caminho | O que faz |
|---|---|
| `/teste-precificacao.html` | Fluxo completo: envia o PDF, mostra valor ou recusa, motivos de revisão, elegibilidade, tempo de atendimento, responsáveis técnicos, link do PDF e correção manual com recálculo |
| `/` (`index.html`) | Extração em lote com correção campo a campo e exportação CSV (base de acurácia da extração) |
| `POST /api/extract` | Lê o PDF com Gemini e devolve JSON com esquema fixo |
| `POST /api/price` | Precifica a partir do JSON extraído (ou corrigido); devolve estimativa ou recusa e grava o histórico |
| `GET /api/relatorio-pdf?id=N` | Relatório de Precificação em PDF de um registro |
| `GET /api/historico` | Lista registros (`?formato=csv`, `?cidade=`, `?revisao=true`, `?limite=`) |
| `POST /api/registrar-avaliacao` | Fluxo pareado: grava o valor da avaliação NBR 14653 de um registro |
| `GET /api/fluxo-pareado` | Fluxo pareado: MAPE, viés e faixas de desvio (`?cidade=`, `?dias=`) |

Todo o site exige autenticação (`middleware.js`). MFA e registro de acesso por
usuário (itens 7.9 e 7.10) estão em implantação.

## Infraestrutura

| Componente | Serviço | Plano | Região |
|---|---|---|---|
| Aplicação e funções | Vercel | Pro | gru1 (São Paulo) |
| Banco de dados | Neon (PostgreSQL 17), via integração Vercel | Pago | AWS sa-east-1 (São Paulo) |
| Leitura de matrículas | Google Gemini API, `gemini-3.1-flash-lite` | Pago (conteúdo não é usado para treino) | — |

Os planos pagos foram adotados pela sensibilidade dos dados (LGPD) e pelo
volume de requisições.

## Extração (api/extract.js)

O Gemini lê o PDF diretamente (inclusive páginas digitalizadas), com
temperatura 0 e esquema JSON fixo. Campos extraídos:

- matrícula, cartório, endereço, CEP;
- áreas privativa, comum, total e fração ideal (com o trecho de onde cada área foi lida);
- dormitórios, banheiros, vagas, elevador, indicação de condomínio;
- datas de averbação da construção e de instituição do condomínio;
- valores de transação registrados.

Cada extração grava `_meta_extracao` (modelo de IA, data/hora, commit).
Campos não encontrados ficam como não informados; nunca são preenchidos por
suposição.

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Obrigatória | Para quê |
|---|---|---|
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | sim | Acesso ao site |
| `GEMINI_API_KEY` | sim | Extração. Chave de projeto com faturamento ativo |
| `APP_ACCESS_KEY` | recomendada | Chave extra exigida pelo `/api/extract` |
| `DATABASE_URL` (ou `STORAGE_DATABASE_URL` da integração Neon) | sim | Histórico, PDF e fluxo pareado |
| `RT_ANALISE_REGISTRO`, `RT_EMISSAO_REGISTRO` | sim | Registro profissional dos RTs (itens 1.3 e 1.4 do roteiro). Sem eles, tela e PDF mostram "PENDENTE" |
| `RT_<FUNCAO>_NOME`, `_FORMACAO`, `_TITULACAO`, `_VINCULO` | opcional | Dados dos RTs (`<FUNCAO>` = `MODELAGEM`, `ANALISE`, `EMISSAO`). CPF não entra aqui |
| `GEMINI_MODEL` | opcional | Troca o modelo de extração sem mexer no código (padrão `gemini-3.1-flash-lite`) |
| `LIMITE_DIARIO_GEMINI` | opcional | Teto diário de chamadas ao Gemini |
| `LISTA_DOCUMENTOS_CONFLITO` | opcional | Documentos para recusa por conflito de interesse (motivo c) |

## Banco de dados

Rode `schema.sql` uma vez no SQL Editor do Neon. É idempotente: cria as tabelas
que faltarem e só acrescenta colunas novas.

## Publicar

```
git add .
git commit -m "mensagem"
git push
```

A Vercel faz o redeploy sozinha. Depois do deploy, teste em
`/teste-precificacao.html` com uma matrícula de São Paulo, uma de cidade não
atendida (deve sair recusa com motivo) e abra o PDF.

## Metodologia

**Em produção: 1.1.1-baseline.** Valor = área × preço/m² de referência do bairro
× fatores de ajuste fixos. Não é modelo estatístico treinado.
- Referência: mediana do preço pedido por m² de apartamentos por bairro
  (anúncios, out/2026). Preço de oferta, não de transação.
- Bairro com poucos anúncios ou não reconhecido vai para revisão manual.
- Recusa (item 9.5): (a) sem área ou cidade não atendida; (b) área privativa
  maior que a total; (c) documento na lista de conflito; (d) cidade não identificada.
- Elegibilidade: critérios da CAIXA configurados em código. Fora do critério vai
  para revisão; não é motivo de recusa.

**Em desenvolvimento: modelo 2.0** treinado com transações reais (ITBI da
Prefeitura de São Paulo, jan/2025 a set/2026), com validação cruzada agrupada
por prédio. Os scripts de dados e de modelo ficam em repositório separado. O
contrato do `/api/price` não muda.

## Histórico de versões

- **1.1.2-baseline (em andamento):** `/api/price` grava os novos campos da
  extração, usuário, commit e ambiente.
- **Extração (out/2026):** novos campos (CEP, condomínio, dormitórios, banheiros,
  vagas, elevador, datas de averbação e de instituição) e `_meta_extracao`.
- **1.1.1-baseline (02/10/2026):** prompt define cada tipo de área e pede o
  trecho de origem; casas usam área construída; área de terreno nunca é base do
  cálculo.
- **1.1.0-baseline (02/10/2026):** São Paulo por bairro; separador de milhar
  nas áreas; cidade pelo cartório; motivos de revisão; recusa na tela; correção
  manual com recálculo; PDF com motivos e RTs; dependências com versão fixa.
- **1.0.0-baseline (24/08/2026):** versão inicial.

## Limites conhecidos

- Baseline usa preço de oferta, que tende a ficar acima do de transação. O fluxo
  pareado mede esse viés.
- Bairros fora da tabela caem na mediana da cidade e vão para revisão.
- Casamento de bairro é por texto; nomes ambíguos ficaram de fora de propósito.
- O Gemini omite campos sem informação em vez de devolver `null`; o código
  trata ausência como "não informado".
- Funções da Vercel limitam o corpo da requisição a ~4,5 MB; PDFs maiores
  falham na extração.
