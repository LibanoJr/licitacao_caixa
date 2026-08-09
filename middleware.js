// middleware.js
// Protege TODO o site (páginas e endpoints /api/*) com usuário e senha.
// Fica na RAIZ do repositório (não dentro de nenhuma pasta).
//
// Não depende de nenhum pacote (@vercel/edge está descontinuado — foi
// unificado em @vercel/functions, mas evitei acoplar nisso pra reduzir
// risco de versão/API errada numa mudança que você não consegue testar
// agora). Middleware da Vercel segue o padrão Web: só retorna uma
// Response quando quer INTERCEPTAR a requisição; se não retornar nada,
// a requisição segue seu caminho normal — não precisa de helper externo
// pra isso.
//
// Usuário e senha ficam em variáveis de ambiente na Vercel (nunca no código).

export const config = {
  // Protege tudo, exceto arquivos internos do Vercel
  matcher: "/((?!_next/static|favicon.ico).*)",
};

export default function middleware(request) {
  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    const basicAuth = authHeader.split(" ")[1];
    const decodificado = atob(basicAuth);
    // Não usar split(":") com desestruturação — se a senha tiver ":" nela
    // (bem provável numa senha forte), corta errado e perde parte da senha.
    // Só o PRIMEIRO ":" separa usuário de senha; o resto pertence à senha.
    const indiceSeparador = decodificado.indexOf(":");
    const usuario = decodificado.slice(0, indiceSeparador);
    const senha = decodificado.slice(indiceSeparador + 1);

    if (
      usuario === process.env.BASIC_AUTH_USER &&
      senha === process.env.BASIC_AUTH_PASSWORD
    ) {
      return; // credenciais corretas — não retornar nada deixa a requisição seguir
    }
  }

  // Sem autenticação válida: navegador mostra a caixinha de login nativa
  return new Response("Autenticação necessária", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Acesso restrito - CR 12/2026 CAIXA"',
    },
  });
}