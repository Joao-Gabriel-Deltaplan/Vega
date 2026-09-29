/**
 * Utilitários para geração de links e termos de navegação (Google Maps e Waze)
 * 
 * DIRETRIZ CRÍTICA:
 * A query de navegação geográfica DEVE conter estritamente o endereço físico (rua, número, bairro, cidade).
 * NUNCA prefixar com o nome de fantasia ou nome do local (ex: "Escritório Deltaplan", "Obra Solar"),
 * pois o Google Maps e Waze buscam estabelecimentos comerciais (POIs) homônimos e posicionam o pino
 * em locais comerciais incorretos em vez do endereço físico real pretendido.
 */

export function gerarTermoBuscaEndereco(endereco?: string, cidade?: string): string {
  let end = (endereco || '').trim();
  const cid = (cidade || '').trim();

  // Limpeza de possíveis prefixos que o usuário tenha digitado no campo endereço
  end = end.replace(/^local:\s*[^|,\n]+[|,\n]\s*/i, '').trim();

  if (!end) return '';

  if (!cid) return end;

  // Evita duplicar se o endereço já contiver a cidade especificada
  if (end.toLowerCase().includes(cid.toLowerCase())) {
    return end;
  }

  return `${end}, ${cid}`;
}

export function gerarLinksNavegacao(
  endereco?: string,
  cidade?: string
): { linkMaps: string; linkWaze: string } {
  const termo = gerarTermoBuscaEndereco(endereco, cidade);
  if (!termo) {
    return { linkMaps: '', linkWaze: '' };
  }

  const query = encodeURIComponent(termo);
  return {
    linkMaps: `https://www.google.com/maps/search/?api=1&query=${query}`,
    linkWaze: `https://waze.com/ul?q=${query}&navigate=yes`,
  };
}
