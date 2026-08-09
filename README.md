# Leitura Automatizada de Matrículas — GEHPA

Solução: **Google Gemini** (`gemini-3.1-flash-lite`) — tier gratuito, lê PDF nativamente, saída em JSON estruturado garantido (`responseSchema`).

## O que mudou nesta rodada

- **Correção em tela**: os campos extraídos agora são editáveis. O engenheiro que testar pode corrigir direto na ficha (nome do proprietário, matrícula, área, endereço, se pertence à Caixa) e adicionar uma observação livre. O CSV exportado sai com valor original da IA + valor corrigido lado a lado, e uma coluna `teve_correcao` — isso é o que vira dado de referência pra medir acurácia e, mais pra frente, treinar o modelo de precificação.
- **Chave de acesso simples**: evita que alguém fora da equipe descubra a URL e consuma sua cota do Gemini direto pela API, sem passar pela tela.
- **Retry automático em erro 429**: se o tier gratuito do Gemini bloquear por limite de requisições por minuto, o servidor tenta de novo automaticamente antes de mostrar erro pro usuário.
- **`imovel_pertence_caixa` agora pode vir `null`**: antes o modelo era obrigado a responder sim/não mesmo quando o documento não deixava isso claro. Agora ele pode dizer "não determinado" — o que é mais seguro do que uma resposta confiante e errada num campo usado pra decisão de leilão.
- **Critério de confiança explícito no prompt**: `alta`/`media`/`baixa` agora tem regra definida, em vez de ficar a critério livre da IA.
- **HTML escapado**: texto extraído do documento não é mais injetado cru na página (evita quebra de layout ou injeção de HTML/script).
- **Aviso de arquivo grande**: PDFs muito grandes (acima de ~3,3 MB) são sinalizados na lista antes de processar, já que podem esbarrar no limite de corpo de requisição da Vercel.

## Estrutura
- `index.html` — a página. Envie os PDFs, confira e corrija os campos, exporte o CSV.
- `api/extract.js` — toda a lógica de leitura mora aqui: prompt, schema e chamada ao Gemini.
- `vercel.json` — aumenta o tempo máximo da function de extração (PDFs maiores ou retries podem passar dos 10s padrão).

## Passo a passo para publicar

### 1. No projeto da Vercel
Acesse seu projeto em vercel.com → **Settings → Environment Variables** e confirme:

| Nome | Valor | Obrigatória? |
|---|---|---|
| `GEMINI_API_KEY` | sua chave gerada em https://aistudio.google.com/apikey | sim |
| `APP_ACCESS_KEY` | uma senha simples que só a equipe do teste vai saber | recomendada — sem ela, o endpoint fica aberto pra qualquer um com o link |

Remova `GEMINI_API_KEY` se ainda estiver lá de uma tentativa anterior, pra não confundir.

### 2. No repositório
Substitua `index.html`, `api/extract.js` e adicione `vercel.json` na raiz. Depois:
```
git add .
git commit -m "MVP: correção em tela, chave de acesso, retry 429, imovel_pertence_caixa nullable"
git push
```
A Vercel faz o redeploy sozinha — acompanhe em vercel.com → seu projeto → Deployments até aparecer "Ready".

### 3. Testar
1. Acesse `https://licitacao-caixa.vercel.app`.
2. Preencha o campo **Chave de acesso** com o valor que você colocou em `APP_ACCESS_KEY` (se configurou).
3. Envie um PDF de matrícula e confira se os campos aparecem preenchidos.
4. Corrija o que estiver errado direto na ficha antes de exportar.
5. Peça pra cada engenheiro te devolver o CSV exportado ao final do teste — é isso que vira a base de acurácia por campo.

## Por que não usar o Groq aqui
O Groq não lê PDF diretamente — seria necessário converter cada página em imagem antes de enviar. Gemini e Claude leem o PDF direto, o que é mais simples e mais confiável para este caso.

## Limites a ter em mente
- Tier gratuito do Gemini: os dados enviados podem ser usados pelo Google para melhorar os modelos deles, e podem ser lidos por revisores humanos. Enquanto isso não for resolvido com quem cuida de compliance do projeto, use documentos anonimizados/fictícios nos testes — não matrícula real.
- Plano Hobby da Vercel aceita corpo de requisição de até ~4,5 MB — o app já avisa quando um PDF está perto disso, mas um arquivo muito grande ainda pode falhar.
- A IA não é infalível — sempre confira o campo `Confiança da extração` e corrija na tela antes de usar o dado na precificação.

## Se algo ainda falhar
Copie a mensagem de erro exibida na tela e me manda — ela já indica onde está o problema (modelo, motivo de bloqueio, chave de acesso, ou trecho da resposta que não virou JSON).
