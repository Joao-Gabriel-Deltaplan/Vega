# Regras Oficiais do Projeto Assistente Delta (VEGA)

Diretrizes obrigatórias e permanentes para desenvolvimento, depuração e manutenção da VEGA.

---

## 1. Integridade do Cofre de Documentos
- **Sem exclusão na indexação:** Nunca executar `DELETE` na tabela `documentos` durante indexação/reindexação. Apenas limpar e recriar registros em `trechos` e atualizar metadados *in-place*.
- **Sem falha silenciosa:** Erros de upload/análise devem exibir alerta visual imediato. Falhas de indexação mantêm o arquivo no Cofre com `status_indexacao = 'erro'` e selo "NÃO INDEXADO".
- **Formatos suportados:** PDF, JPG, JPEG, PNG e WEBP. OCR via `gpt-5.4-mini` para imagens. Nunca filtrar código exclusivamente por `.pdf`.

---

## 2. Modelos de IA Permitidos
Uso restrito e exclusivo dos seguintes modelos OpenAI homologados:
- **`gpt-5.4-mini`**: Chat, raciocínio, visão OCR e extração cadastral.
- **`text-embedding-3-small`**: Embeddings vetoriais e busca semântica.
- **`gpt-transcribe`**: Transcrição de áudios do WhatsApp.
Proibido introduzir outros modelos ou aliases legados (gpt-4o, whisper-1, etc.).

---

## 3. Armazenamento e Fuso Horário (Supabase & Railway)
- **Persistência total no Supabase:** Dados no PostgreSQL e arquivos no Supabase Storage. O Railway é efêmero: nada pode depender de disco local (`arquivos/`, `data/`); arquivos locais são apenas cache temporário.
- **Datas e Horários:** Gravação no banco sempre em UTC (ISO 8601). Exibição ao usuário (painel, WhatsApp, alertas, relatórios) e rotinas diárias ("hoje", "este mês") convertidas obrigatoriamente para `America/Sao_Paulo` (Brasília).

---

## 4. Proteção de Dados e Segurança
- **Nomes proibidos e ausência de hardcodes:** Nenhum nome de pessoa, telefone, ID de titular ou data real pode estar escrito no código. Titular não identificado é nulo e a VEGA pergunta; nunca assume um titular padrão. NUNCA usar nomes fictícios de pessoas (especialmente sobrenome Brandini) em código, testes, scripts ou logs. Usar consultas dinâmicas ao Supabase ou "Titular Teste".
- **Sigilo de credenciais:** NUNCA expor variáveis de ambiente (`.env`), chaves de API, tokens ou senhas em logs, commits ou relatórios.
- **Preservação de fichas:** Dados cadastrais já conferidos (`conferido: true`) ou informados pelo chat nunca podem ser sobrescritos por extração automática.
- **Reconhecimento estrito de titulares:** Titular só é reconhecido se constar no cadastro oficial do Supabase; nunca extrair nomes por posição na frase.

---

## 5. Idioma e Comunicação
- Todas as respostas, interfaces, mensagens, relatórios e explicações devem ser sempre em Português do Brasil.

---

## 6. Saudações e Pedidos de Documentos
- **Escopo absoluto de documentos:** Pedidos de qualquer documento (contrato, certidão, alvará, nota, etc.) são sempre do escopo. Se não existir no Cofre, responder: `"Não encontrei esse documento no Cofre."` (incorporando saudação inicial, se houver). Classificação "fora de escopo" é restrita a assuntos alheios à empresa.
- **Saudação + Pedido:** Tratar como pedido de documento, incorporando a saudação exclusivamente no início da resposta.
- **Pedido sem titular especificado:**
  - 1 documento do tipo no Cofre: envia direto com anexo.
  - Vários documentos de titulares diferentes: pergunta listando opções numeradas.
  - Nenhum documento: responde `"Não encontrei esse documento no Cofre."`.

---

## 7. Classificação e Titularidade no Cofre
- **Sem preenchimento padrão:** A IA jamais deve atribuir "Delta Plan" ou "Outros" se não houver identificação inequívoca no documento. Deixar campos vazios e solicitar preenchimento ao usuário.
- **Tipos dinâmicos:** Classificar pelo nome real do documento (Passaporte, Contrato, etc.). "Outros" só em último caso com confirmação.
- **Identificação pessoal:** Titular deve ser extraído do documento; se não cadastrado, perguntar se deseja cadastrar.
- **Vínculo por ID:** Vinculação estrita por ID de cadastro. Exibição e agrupamento sempre pelo nome oficial cadastrado (reconhecendo nome completo, primeiro nome ou apelido existente).

---

## 8. Bloqueio Rígido por Tipo Documental
- **Sem entrega divergente:** Se o tipo solicitado não existir no Cofre (ex.: certidão de nascimento quando só há certidão de casamento), nunca entregar outro tipo. Responder: `"Não encontrei esse documento no Cofre."` (opcionalmente listando os documentos existentes do titular, sem anexos).
- **Siglas e PJ:** Reconhecer siglas técnicas oficiais (ART, RRT) e termos significativos de PJs cadastradas (ex.: nome fantasia, sigla ou termo principal da razão social cadastrada no Supabase).

---

## 9. Resumos, Conteúdo e Catálogo
- **Resumos:** Pedidos de resumo/explicação logo após entrega de anexo são estritamente `pergunta_conteudo`, nunca `pedir_arquivo`. Responder em texto sintético sem reenviar anexo.
- **Fatos documentais vs Nascimento:** Responder com a data exata do fato jurídico registrado (ex.: dispensa militar, registro de casamento), nunca com data de nascimento.
- **Fallback vetorial:** Dados cadastrais não estruturados na ficha devem ser consultados nos trechos dos documentos do titular, oferecendo o documento fonte.
- **Listagem de catálogo:** Perguntas amplas ("o que tem no cofre?") classificam como `listar_documentos` e exibem lista organizada por titular, sem anexos.

---

## 10. Documentos Faltantes e Inexistentes
- **Registro cumulativo:** Documento não encontrado deve ser registrado em `documentos_faltantes`. Se já existir para o mesmo titular/tipo, somar contagem (`quantidade_pedidos`) e atualizar data, sem duplicar.
- **Estrutura da resposta:**
  1. `"Não encontrei [artigo] *[Tipo]* d[prep] *[Titular]* no Cofre."` (com saudação se houver).
  2. `"Anotei na lista de documentos pendentes."`
  3. Se o dado constar em outro documento do titular no Cofre, oferecer a informação.
  4. Proibido prometer dados inexistentes ou despejar lista completa de documentos disponíveis.
- **Baixa automática:** Adição de documento ao Cofre marca pendências correspondentes como providenciadas automaticamente.

---

## 11. Integridade de Conversas do WhatsApp e Painel
- **Gravação obrigatória:** Toda mensagem enviada ou recebida no WhatsApp (texto, áudio, documentos, fotos, PIX, links, contatos, informativos, correções) deve ser gravada no Supabase e exibível no painel.
- **Exibição rica:** Painel deve renderizar links clicáveis, áudios com player/transcrição, cards de anexos para abrir/baixar, itens estruturados e miniaturas.
- **Sem bolha vazia:** Proibido mensagens invisíveis ou vazias; exibir card informativo legível com horário para eventos sem texto.

---

## 12. PDFs Protegidos por Senha
- **Detecção preventiva:** Detectar proteção antes de tentar extração/OCR. Definir `status_indexacao = 'protegido_senha'` e selo "Protegido por senha" (cadeado âmbar), nunca erro genérico.
- **Mensagem oficial:** `"Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele."`
- **Destravamento:** Permitir inserção da senha no painel para reindexação em memória. JAMAIS persistir ou registrar a senha em banco, arquivos, metadados ou logs.

---

## 13. Preservação de Contexto e Sanitização de Termos
- **Recuperação de contexto:** Pedidos de envio sem nome de documento ("me envie o pdf", "show, agora solta esse arquivo aí", "manda ele", "pode enviar") devem recuperar o documento discutido no histórico recente e enviá-lo com anexo.
- **Classificação por IA como mecanismo primário:** A IA (`gpt-5.4-mini`) deve preencher `documento_citado` e `termo_busca` SOMENTE quando houver tipo/nome de documento real. Para comandos genéricos e gírias de envio, deve retornar vazios (`""`), permitindo o uso do contexto.
- **Sanitização como proteção extra:** A mensagem inteira nunca pode virar documento citado. Sanitização por lista atua como camada de segurança secundária. Sem documento citado e sem contexto prévio, perguntar qual documento o usuário deseja; nunca inventar arquivo nem registrar frase em faltantes.
- **Validação estrita de faltantes:** A tabela `documentos_faltantes` só aceita tipos documentais reais e reconhecíveis (Certidão, Contrato, Alvará, CNH, RG, Apólice, etc.). Proibido registrar comandos, cortesias ou frases soltas.

---

## 14. Blindagem Estrita de Dados Pessoais sem Titular
- **Sem titular, sem entrega:** Quando um dado pessoal cadastral for solicitado (CPF, RG, CNH, data de nascimento, filiação, endereço residencial) sem titular citado na mensagem atual e sem titular identificado no histórico recente daquela conversa específica, a VEGA NUNCA assume nenhum titular, mesmo que exista apenas um titular cadastrado ou que apenas um documento contenha o dado.
- **Formato obrigatório da pergunta:** A resposta deve ser direta e específica ao campo solicitado: `"De quem você precisa do [campo]?"` (ex.: `"De quem você precisa do CPF?"`), incorporando saudação inicial se houver. É PROIBIDO listar os titulares cadastrados ou tentar adivinhar a pessoa.
- **Validade para busca vetorial e ficha:** Um único resultado retornado pela busca na ficha cadastral ou pela busca vetorial de trechos jamais autoriza a entrega de dados pessoais sem que o titular tenha sido determinado.
- **Diferenciação para pedidos de arquivo:** Para pedidos de documentos físicos/arquivos (`pedir_arquivo`), se houver apenas um documento daquele tipo no Cofre, mantém-se a entrega direta com anexo.
