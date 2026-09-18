async function testarEndpoints() {
  const endpoints = [
    { nome: 'Documentos do cofre', url: 'http://localhost:4301/api/documentos' },
    { nome: 'Base de conhecimento', url: 'http://localhost:4301/api/conhecimento' },
    { nome: 'Alertas de vencimento', url: 'http://localhost:4301/api/vencimentos/alertas' },
    { nome: 'Lista de conversas', url: 'http://localhost:4301/api/conversas' },
    { nome: 'Download PDF do Storage (CARTÃO DE VACINAS.pdf)', url: 'http://localhost:4301/arquivos/CART%C3%83O%20DE%20VACINAS.pdf', isBuffer: true },
    { nome: 'Download PDF do Storage (CNH DIGITAL THOMAZ.pdf)', url: 'http://localhost:4301/arquivos/CNH%20DIGITAL%20THOMAZ.pdf', isBuffer: true },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url);
      if (!res.ok) {
        console.error(`❌ [${ep.nome}] Status: ${res.status} ${res.statusText}`);
      } else {
        if (ep.isBuffer) {
          const buf = await res.arrayBuffer();
          console.log(`✔ [${ep.nome}] Status: ${res.status} OK | Tamanho recebido: ${(buf.byteLength / 1024).toFixed(1)} KB`);
        } else {
          const json = await res.json();
          const count = Array.isArray(json) ? json.length : Object.keys(json).length;
          console.log(`✔ [${ep.nome}] Status: ${res.status} OK | Itens recebidos: ${count}`);
        }
      }
    } catch (e: any) {
      console.error(`❌ [${ep.nome}] Erro de conexão:`, e.message);
    }
  }
}

testarEndpoints().catch(console.error);
