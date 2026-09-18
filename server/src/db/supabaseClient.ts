import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase autenticado via service_role.
 * Lança erro claro se as variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não estiverem preenchidas.
 * Nunca imprime os valores das variáveis em logs ou erros.
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl) {
    throw new Error('Variável SUPABASE_URL não configurada no .env');
  }

  if (!supabaseServiceKey) {
    throw new Error('Variável SUPABASE_SERVICE_ROLE_KEY não configurada no .env');
  }

  supabaseInstance = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseInstance;
}
