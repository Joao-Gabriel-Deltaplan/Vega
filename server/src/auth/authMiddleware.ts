import { Request, Response, NextFunction } from 'express';
import { validarTokenSessao, SessaoUsuario } from './authService.js';

declare global {
  namespace Express {
    interface Request {
      usuario?: SessaoUsuario;
    }
  }
}

/**
 * Middleware para proteger rotas da API e arquivos estáticos confidenciais.
 * Exige cookie httpOnly de sessão válida ou Bearer Token.
 * Exceções: endpoints de autenticação e endpoints de webhook do WhatsApp.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const caminho = req.path;

  // 1. Exceção: endpoints públicos de autenticação do painel
  if (
    caminho === '/api/auth/login' ||
    caminho === '/api/auth/status' ||
    caminho === '/api/auth/logout'
  ) {
    return next();
  }

  // 2. Exceção: endpoints de webhook do WhatsApp (autenticados exclusivamente via WEBHOOK_TOKEN)
  if (caminho.startsWith('/api/webhook') || caminho.startsWith('/webhook')) {
    return next();
  }

  // 3. Verifica se a rota precisa de proteção: todas as rotas /api/* e /arquivos/*
  const requerProtecao = caminho.startsWith('/api/') || caminho.startsWith('/arquivos');

  if (!requerProtecao) {
    // Rotas estáticas do frontend (HTML, JS, CSS, favicon) são públicas para exibir a tela de login
    return next();
  }

  // 4. Extração do token: prioriza cookie vega_session, com fallback para Authorization Bearer
  let token: string | undefined = req.cookies?.vega_session;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  if (!token) {
    if (caminho.startsWith('/arquivos')) {
      return res.status(401).json({
        erro: 'Acesso negado. Faça login no painel para visualizar ou baixar documentos.',
      });
    }
    return res.status(401).json({
      erro: 'Não autorizado. Faça login para continuar.',
    });
  }

  // 5. Validação criptográfica da sessão
  const sessao = validarTokenSessao(token);
  if (!sessao) {
    if (caminho.startsWith('/arquivos')) {
      return res.status(401).json({
        erro: 'Sessão expirada ou inválida. Faça login novamente para acessar documentos.',
      });
    }
    return res.status(401).json({
      erro: 'Sessão expirada ou inválida. Faça login novamente.',
    });
  }

  // Sessão válida: anexa os dados do usuário logado na requisição
  req.usuario = sessao;
  return next();
}
