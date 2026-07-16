# Leitura Automatizada de Matrículas — GEHPA

Solução definitiva: **Google Gemini** (`gemini-3.1-flash-lite`) — gratuito, lê PDF nativamente, saída em JSON estruturado garantido (`responseSchema`).

## Estrutura
- `index.html` — a página. Não precisa mexer em nada aqui.
- `api/extract.js` — toda a lógica de leitura mora aqui: o prompt, o formato dos dados e a chamada pro Gemini já estão fixos dentro do arquivo. O front-end só manda o PDF.

## Passo a passo (defintivo)

### 1. No projeto da Vercel
1. Acesse o seu projeto em vercel.com → **Settings → Environment Variables**.
2. Confirme que existe **apenas** esta variável (remova `ANTHROPIC_API_KEY` se ela ainda estiver lá, de uma tentativa anterior, pra não confundir):
   - Nome: `GEMINI_API_KEY`
   - Valor: sua chave gerada em https://aistudio.google.com/apikey
3. Salve.

### 2. No repositório
1. Substitua o `index.html` da raiz do repositório pelo arquivo anexado.
2. Substitua o `api/extract.js` pelo arquivo anexado.
3. Commit e push:
```
git add .
git commit -m "fix definitivo: schema Gemini + prompt fixo no backend"
git push
```
4. A Vercel faz o redeploy sozinha. Acompanhe em vercel.com → seu projeto → Deployments até aparecer "Ready".

### 3. Testar
Acesse `https://licitacao-caixa.vercel.app`, envie um PDF de matrícula e confira se os campos aparecem preenchidos (não mais com "—").

## Por que não usar o Groq aqui
O Groq não lê PDF diretamente — seria necessário converter cada página em imagem antes de enviar (uma etapa a mais, com mais chance de falha). Gemini e Claude leem o PDF direto, o que é mais simples e mais confiável para este caso, que exige o mínimo de erro possível.

## Se algo ainda falhar
Copie a mensagem de erro exibida na tela (agora ela vem detalhada — modelo, motivo de bloqueio, ou trecho da resposta que não virou JSON) e me manda — ela já indica exatamente onde está o problema.
