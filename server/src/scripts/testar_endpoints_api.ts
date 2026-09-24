async function testarEndpoints() {
  const baseEndpoints = [
    { nome: 'Documentos do cofre', url: 'http://localhost:4301/api/documentos' },
    { nome: 'Base de conhecimento', url: 'http://localhost:4301/api/conhecimento' },
    { nome: 'Alertas de vencimento', url: 'http://localhost:4301/api/vencimentos/alertas' },
    { nome: 'Lista de conversas', url: 'http://localhost:4301/api/conversas' },
  ];

  for (const ep of baseEndpoints) {
    try {
      const res = await fetch(ep.url);
      if (!res.ok) {
        console.error(`❌ [${ep.nome}] Status: ${res.status} ${res.statusText}`);
      } else {
        const json = await res.json();
        const count = Array.isArray(json) ? json.length : Object.keys(json).length;
        console.log(`✔ [${ep.nome}] Status: ${res.status} OK | Itens recebidos: ${count}`);

        // Se for documentos, testa download do primeiro arquivo retornado dinamicamente
        if (ep.nome === 'Documentos do cofre' && Array.isArray(json) && json.length > 0) {
          const primeiroDoc = json[0];
          if (primeiroDoc?.arquivo) {
            const urlDownload = `http://localhost:4301/arquivos/${encodeURIComponent(primeiroDoc.arquivo)}`;
            try {
              const resDownload = await fetch(urlDownload);
              if (resDownload.ok) {
                const buf = await resDownload.arrayBuffer();
                console.log(`✔ [Download PDF Storage: ${primeiroDoc.arquivo}] Status: ${resDownload.status} OK | Tamanho: ${(buf.byteLength / 1024).toFixed(1)} KB`);
              } else {
                console.warn(`⚠️ [Download PDF Storage: ${primeiroDoc.arquivo}] Status: ${resDownload.status}`);
              }
            } catch (err: any) {
              console.warn(`⚠️ [Download PDF Storage] Erro:`, err.message);
            }
          }
        }
      }
    } catch (e: any) {
      console.error(`❌ [${ep.nome}] Erro de conexão:`, e.message);
    }
  }
}

testarEndpoints().catch(console.error);
