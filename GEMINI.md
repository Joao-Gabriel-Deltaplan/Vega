# Regras Oficiais do Projeto Assistente Delta (VEGA)

As regras abaixo são obrigatórias, permanentes e devem ser rigorosamente seguidas pelo Antigravity em qualquer modificação, depuração, teste ou geração de código neste projeto.

---

## 1. Integridade do Cofre de Documentos (Base da VEGA)

- **Nunca apagar registros da tabela `documentos` durante a indexação:**
  O indexador (`indexadorAutomatico.ts`) jamais deve executar comandos de exclusão (`DELETE`) na tabela `documentos`. Em caso de reindexação ou atualização de um documento existente, deve apenas limpar e recriar os registros correspondentes na tabela `trechos` (`eq('documento_id', doc.id)`), atualizando os metadados do documento *in-place*.
- **Nunca sumir em silêncio:**
  Nenhum arquivo enviado pode desaparecer sem aviso.
  - Se o upload ou análise falhar no frontend/backend, o erro deve ser exibido imediatamente na tela do usuário via alerta vermelho com o motivo da falha.
  - Se a indexação falhar por qualquer motivo (extração, chunking, embeddings), o documento **continua na tabela `documentos` e na lista do Cofre**, com `status_indexacao = 'erro'` e o selo vermelho **"NÃO INDEXADO"** visível junto à mensagem descritiva do erro.
- **Formatos de arquivo aceitos no Cofre:**
  O Cofre suporta nativamente **PDF, JPG, JPEG, PNG e WEBP**. Nunca filtrar códigos, uploads ou visualizadores exclusivamente por `.pdf`. Para imagens, utilizar visão computacional (`gpt-5.4-mini`) para extração OCR de texto.

---

## 2. Modelos de Inteligência Artificial Permitidos

Apenas os seguintes modelos da OpenAI são homologados e autorizados no projeto:
- **`gpt-5.4-mini`**: para inteligência, orquestração de chat, visão OCR em imagens/PDFs e extração de dados cadastrais.
- **`text-embedding-3-small`**: para geração de embeddings vetoriais e busca semântica de trechos.
- **`gpt-transcribe`**: para transcrição de áudios recebidos pelo WhatsApp.

Nenhum outro modelo ou alias obsoleto (ex: gpt-4o, gpt-3.5-turbo, whisper-1) deve ser introduzido no código.

---

## 3. Armazenamento e Infraestrutura em Nuvem (Supabase & Railway)

- **Persistência total no Supabase:**
  Todos os dados (conversas, mensagens, documentos, fichas, alertas, rastros e usuários) residem no Supabase (PostgreSQL e Supabase Storage).
  O servidor roda em container efêmero no Railway. **Nada pode depender de persistência em disco local** (`arquivos/`, `data/`, etc.). Qualquer arquivo salvo localmente deve ser tratado apenas como cache temporário, mantendo o arquivo mestre no Storage privado (`documentos` ou `audios`).
- **Fusos Horários e Datas:**
  - Todas as datas e timestamps gravados no banco devem estar em **UTC (formato ISO 8601)**.
  - Toda exibição para o usuário (no painel web, em mensagens enviadas pela VEGA no WhatsApp, alertas de vencimento e relatórios) deve ser obrigatoriamente convertida para o fuso **`America/Sao_Paulo`** (horário de Brasília).
  - Rotinas diárias e verificações ("hoje", "vencendo hoje", "este mês") devem basear-se na data corrente de Brasília, nunca na data UTC bruta.

---

## 4. Proteção de Dados, Fichas e Segurança

- **Nomes Proibidos:**
  NUNCA usar nomes inventados de pessoas (ex.: nomes fictícios com sobrenome Brandini) em código-fonte, testes automatizados, scripts, exemplos ou logs. Usar sempre os titulares reais ou dados genéricos ("Titular Teste").
- **Proteção de Segredos e Variáveis de Ambiente:**
  NUNCA imprimir, registrar ou expor valores reais de variáveis de ambiente (`.env`), chaves de API (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_KEY`), tokens de autenticação ou senhas em respostas, commits, arquivos de log ou relatórios de walkthrough.
- **Preservação de Dados da Ficha do Titular:**
  Campos da ficha de titular que já foram conferidos pelo usuário (`conferido: true`) ou que foram expressamente informados/corrigidos através do chat **jamais** podem ser sobrescritos por rotinas de extração automática de documentos.
- **Reconhecimento Estrito de Titulares:**
  Titular só é reconhecido se existir no cadastro de titulares; nunca extrair nome de pessoa por posição na frase (ex.: após "do/da/de"). Qualquer palavra não cadastrada como titular deve ser ignorada.

---

## 5. Idioma e Comunicação

- Todas as respostas, explicações, relatórios e mensagens de interface devem ser sempre entregues em **Português do Brasil**.

---

## 6. Tratamento de Saudações e Pedidos de Documentos no Chat e WhatsApp

- **Saudação + Pedido na mesma mensagem:**
  Mensagens que combinam saudação com pedido (ex.: *"Bom dia, me envia certidão de casamento"*, *"Oi, preciso do CREA"*, *"Boa tarde, me manda a CNH"*) devem ser tratadas como o pedido do documento. A saudação do usuário deve ser incorporada exclusivamente no início da resposta (ex.: *"Bom dia, [Nome]! Aqui está o documento solicitado: ..."*).
- **Pedido de documento sem titular especificado:**
  - Se existir **apenas UM** documento daquele tipo no Cofre: enviar diretamente com anexo, sem perguntas intermediárias.
  - Se existirem **vários documentos daquele tipo pertencentes a titulares diferentes**: perguntar ao usuário listando as opções numeradas (ex.: *"Encontrei certidões de: 1) Thomaz, 2) André. Qual delas?"*).
  - Se **nenhum documento** daquele tipo existir no Cofre: responder cordialmente que não encontrou o documento.

