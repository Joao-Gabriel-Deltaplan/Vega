import crypto from 'crypto';

export interface SessaoUsuario {
  userId: string;
  nome: string;
  role: 'admin' | 'usuario';
  authType: 'master_password' | 'usuario_senha';
  criadoEm: number;
  expiraEm: number;
}

export interface ResultadoLogin {
  sucesso: boolean;
  erro?: string;
  bloqueado?: boolean;
  tempoRestanteMin?: number;
  token?: string;
  usuario?: {
    userId: string;
    nome: string;
    role: string;
  };
}

// Configurações
const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MAX_TENTATIVAS_FALHAS = 5;
const JANELA_BLOQUEIO_MS = 15 * 60 * 1000; // 15 minutos

// Controle de Rate Limit por IP em memória
interface TentativaRegistro {
  falhas: number;
  bloqueadoAte?: number;
  ultimaTentativa: number;
}
const tentativasPorIp = new Map<string, TentativaRegistro>();

function obterSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.trim().length >= 16) {
    return secret.trim();
  }
  // Fallback derivado da própria senha ou semente estável para a instância
  const base = process.env.PAINEL_SENHA || 'delta_plan_default_fallback_seed_2026';
  return crypto.createHash('sha256').update(`vega_session_${base}`).digest('hex');
}

/**
 * Gera um token assinado HMAC-SHA256 para a sessão
 */
export function gerarTokenSessao(dados: Omit<SessaoUsuario, 'criadoEm' | 'expiraEm'>): string {
  const agora = Date.now();
  const sessao: SessaoUsuario = {
    ...dados,
    criadoEm: agora,
    expiraEm: agora + DURACAO_SESSAO_MS,
  };

  const payloadJson = JSON.stringify(sessao);
  const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url');
  const hmac = crypto
    .createHmac('sha256', obterSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${hmac}`;
}

/**
 * Valida a assinatura e a data de expiração do token de sessão
 */
export function validarTokenSessao(token: string): SessaoUsuario | null {
  try {
    if (!token || typeof token !== 'string') return null;

    const partes = token.split('.');
    if (partes.length !== 2) return null;

    const [payloadB64, assinatura] = partes;
    if (!payloadB64 || !assinatura) return null;

    // Recalcula HMAC e compara com tempo constante
    const hmacEsperado = crypto
      .createHmac('sha256', obterSessionSecret())
      .update(payloadB64)
      .digest('base64url');

    const bufAssinatura = Buffer.from(assinatura, 'utf-8');
    const bufEsperado = Buffer.from(hmacEsperado, 'utf-8');

    if (bufAssinatura.length !== bufEsperado.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(bufAssinatura, bufEsperado)) {
      return null;
    }

    // Decodifica payload
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const sessao: SessaoUsuario = JSON.parse(jsonStr);

    // Verifica expiração
    if (!sessao.expiraEm || Date.now() > sessao.expiraEm) {
      return null;
    }

    return sessao;
  } catch {
    return null;
  }
}

/**
 * Verifica o status de rate limiting para um determinado IP
 */
export function verificarRateLimit(ip: string): { permitido: boolean; tempoRestanteMin?: number } {
  const agora = Date.now();
  const registro = tentativasPorIp.get(ip);

  if (!registro) return { permitido: true };

  // Se estiver bloqueado
  if (registro.bloqueadoAte && registro.bloqueadoAte > agora) {
    const tempoRestanteMin = Math.ceil((registro.bloqueadoAte - agora) / (60 * 1000));
    return { permitido: false, tempoRestanteMin };
  }

  // Se o bloqueio expirou ou passou da janela de bloqueio, reseta
  if (agora - registro.ultimaTentativa > JANELA_BLOQUEIO_MS) {
    tentativasPorIp.delete(ip);
    return { permitido: true };
  }

  return { permitido: true };
}

/**
 * Autentica o acesso ao painel via senha mestra (ou futuramente usuário/senha)
 */
export async function autenticarPainel(dados: {
  senha?: string;
  usuario?: string;
  ip: string;
}): Promise<ResultadoLogin> {
  const { senha, usuario, ip } = dados;
  const agora = Date.now();

  console.log(`[Auth 🔒] Tentativa de login recebida de IP: ${ip}`);

  // 1. Checa bloqueio temporário por rate limit
  const statusRateLimit = verificarRateLimit(ip);
  if (!statusRateLimit.permitido) {
    console.warn(
      `[Auth 🚫] Tentativa rejeitada: IP ${ip} está temporariamente bloqueado (${statusRateLimit.tempoRestanteMin} min restantes).`
    );
    return {
      sucesso: false,
      bloqueado: true,
      tempoRestanteMin: statusRateLimit.tempoRestanteMin,
      erro: `Muitas tentativas incorretas. Tente novamente em ${statusRateLimit.tempoRestanteMin} minuto(s).`,
    };
  }

  const senhaCadastrada = process.env.PAINEL_SENHA;
  if (!senhaCadastrada || senhaCadastrada.trim() === '') {
    console.error('[Auth ⚠️] Variável PAINEL_SENHA não configurada no .env ou no Railway!');
    return {
      sucesso: false,
      erro: 'Servidor não configurado com senha de acesso ao painel.',
    };
  }

  // 2. Comparação segura de senha sem vazar timing
  const hashRecebido = crypto.createHash('sha256').update(senha || '').digest();
  const hashEsperado = crypto.createHash('sha256').update(senhaCadastrada.trim()).digest();
  const senhaCorreta = crypto.timingSafeEqual(hashRecebido, hashEsperado);

  if (!senhaCorreta) {
    // Incrementa falha para o IP
    const registro = tentativasPorIp.get(ip) || { falhas: 0, ultimaTentativa: agora };
    registro.falhas += 1;
    registro.ultimaTentativa = agora;

    if (registro.falhas >= MAX_TENTATIVAS_FALHAS) {
      registro.bloqueadoAte = agora + JANELA_BLOQUEIO_MS;
      tentativasPorIp.set(ip, registro);
      console.warn(
        `[Auth 🚫] IP ${ip} bloqueado temporariamente por 15 minutos após ${MAX_TENTATIVAS_FALHAS} falhas consecutivas.`
      );
      return {
        sucesso: false,
        bloqueado: true,
        tempoRestanteMin: 15,
        erro: 'Muitas tentativas incorretas. Seu IP foi temporariamente bloqueado por 15 minutos.',
      };
    }

    tentativasPorIp.set(ip, registro);
    const restantes = MAX_TENTATIVAS_FALHAS - registro.falhas;
    console.warn(
      `[Auth ❌] Falha no login: senha incorreta (${registro.falhas}/${MAX_TENTATIVAS_FALHAS}) | IP: ${ip}`
    );
    return {
      sucesso: false,
      erro: `Senha incorreta. Você tem mais ${restantes} tentativa(s) antes do bloqueio temporário.`,
    };
  }

  // 3. Sucesso: limpa tentativas falhas do IP
  tentativasPorIp.delete(ip);
  console.log(`[Auth ✅] Login realizado com sucesso para o painel via IP: ${ip}`);

  // 4. Cria sessão estruturada (preparada para múltiplos usuários no futuro)
  const usuarioInfo = {
    userId: usuario?.trim() || 'admin',
    nome: 'Painel (senha única)',
    role: 'admin' as const,
    authType: 'master_password' as const,
  };

  const token = gerarTokenSessao(usuarioInfo);

  return {
    sucesso: true,
    token,
    usuario: {
      userId: usuarioInfo.userId,
      nome: usuarioInfo.nome,
      role: usuarioInfo.role,
    },
  };
}
