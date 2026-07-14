# Leitura Automatizada de Matrículas — GEHPA

## O que é
- `public/index.html` — a página que qualquer pessoa acessa e envia os PDFs.
- `api/extract.js` — função de servidor (roda na Vercel) que lê o PDF usando a IA e devolve os dados extraídos. É aqui que fica a chave de API, protegida — nunca no navegador do usuário.

## Passo a passo para publicar (gratuito)

### 1. Pegar uma chave de API da Anthropic
1. Acesse https://console.anthropic.com
2. Crie uma conta (ou entre na conta já usada pela equipe/projeto).
3. Vá em **API Keys** e crie uma chave.
4. Adicione crédito na conta (Billing) — o uso da API é cobrado por uso, separado de qualquer plano do Claude.ai.

### 2. Subir este código para o GitHub
1. Crie um repositório novo no GitHub.
2. Envie esta pasta inteira (`public/`, `api/`, `package.json`) para o repositório.

### 3. Publicar na Vercel
1. Acesse https://vercel.com e crie uma conta gratuita (pode entrar direto com o GitHub).
2. Clique em **Add New → Project** e selecione o repositório que você acabou de criar.
3. Antes de finalizar o deploy, vá em **Environment Variables** e adicione:
   - Nome: `ANTHROPIC_API_KEY`
   - Valor: a chave que você gerou no passo 1
4. Clique em **Deploy**.
5. Em alguns segundos a Vercel gera um link público, algo como `https://leitura-matriculas-gehpa.vercel.app` — esse é o link que qualquer pessoa da equipe pode acessar.

### 4. Testar
- Acesse o link gerado, envie um PDF de matrícula e confira o resultado.
- Se der erro "ANTHROPIC_API_KEY não configurada", confira se a variável foi salva certinho e refaça o deploy (Vercel → Deployments → Redeploy).

## Limites a ter em mente
- O plano gratuito (Hobby) da Vercel aceita requisições de até ~4,5 MB — como as certidões têm poucas páginas, isso costuma ser suficiente, mas um PDF muito grande (dezenas de páginas escaneadas em alta resolução) pode esbarrar nesse limite.
- A IA não é infalível em 100% dos casos — o campo `confianca_extracao` de cada documento serve exatamente para sinalizar quando vale a pena conferir manualmente antes de usar o dado na precificação.
