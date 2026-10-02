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

// Usuários aceitos:
//  1. BASIC_AUTH_USERS — lista "usuario:senha" separada por vírgula, ex:
//       libano:Senha1!,rogerio:Senha2@,ana:Senha3#
//     (a senha pode ter ":"; só não pode ter "," nem espaço nas pontas)
//  2. BASIC_AUTH_USER + BASIC_AUTH_PASSWORD — o usuário único antigo,
//     que continua valendo junto com a lista.
function carregarUsuarios() {
  const usuarios = new Map();
  for (const item of (process.env.BASIC_AUTH_USERS || "").split(",")) {
    const i = item.indexOf(":");
    if (i <= 0) continue;
    const usuario = item.slice(0, i).trim();
    const senha = item.slice(i + 1).trim();
    if (usuario && senha) usuarios.set(usuario, senha);
  }
  if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD) {
    usuarios.set(process.env.BASIC_AUTH_USER, process.env.BASIC_AUTH_PASSWORD);
  }
  return usuarios;
}

// atob devolve os bytes crus; isto reinterpreta como UTF-8, pra senha com
// acento (é, ç) bater com o valor salvo na Vercel.
function decodificarBase64Utf8(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export default function middleware(request) {
  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    let decodificado = "";
    try {
      decodificado = decodificarBase64Utf8(authHeader.split(" ")[1] || "");
    } catch {
      decodificado = ""; // header malformado: trata como sem credencial (401), não 500
    }
    // Só o PRIMEIRO ":" separa usuário de senha; o resto pertence à senha.
    const indiceSeparador = decodificado.indexOf(":");
    const usuario = decodificado.slice(0, indiceSeparador);
    const senha = decodificado.slice(indiceSeparador + 1);

    const usuarios = carregarUsuarios();
    if (indiceSeparador > 0 && usuarios.has(usuario) && usuarios.get(usuario) === senha) {
      return; // credenciais corretas — não retornar nada deixa a requisição seguir
    }
  }

  // Sem autenticação válida: navegador mostra a caixinha de login nativa
  return new Response("Autenticação necessária", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Acesso restrito - CR 12/2026 CAIXA", charset="UTF-8"',
    },
  });
}
