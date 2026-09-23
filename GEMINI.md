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

- **Escopo Absoluto de Documentos e Mensagem Padrão:**
  Pedidos de **qualquer tipo de documento** (contrato, alvará, certidão, nota, comprovante, procuração, termo, recibo, declaração, estatuto, etc.) são **sempre do escopo da VEGA**. Se o documento não existir no Cofre, a resposta deve ser obrigatoriamente: `"Não encontrei esse documento no Cofre."` (com a saudação incorporada no início se o usuário saudou). A classificação de **"fora de escopo"** é reservada estritamente para assuntos que não têm relação com documentos ou informações da empresa (ex.: receitas culinárias, previsão do tempo, esportes, piadas, cálculos matemáticos aleatórios).
- **Saudação + Pedido na mesma mensagem:**
  Mensagens que combinam saudação com pedido (ex.: *"Bom dia, me envia certidão de casamento"*, *"Oi, preciso do CREA"*, *"Boa tarde, me manda a CNH"*) devem ser tratadas como o pedido do documento. A saudação do usuário deve ser incorporada exclusivamente no início da resposta (ex.: *"Bom dia, [Nome]! Aqui está o documento solicitado: ..."*).
- **Pedido de documento sem titular especificado:**
  - Se existir **apenas UM** documento daquele tipo no Cofre: enviar diretamente com anexo, sem perguntas intermediárias.
  - Se existirem **vários documentos daquele tipo pertencentes a titulares diferentes**: perguntar ao usuário listando as opções numeradas (ex.: *"Encontrei certidões de: 1) Thomaz, 2) [Titular 2]. Qual delas?"*).
  - Se **nenhum documento** daquele tipo existir no Cofre: responder obrigatoriamente *"Não encontrei esse documento no Cofre."*.

---

## 7. Classificação e Titularidade de Documentos no Cofre

- **Nunca preencher titular ou tipo com valor padrão quando a IA não identificar; perguntar ao usuário:**
  Ao processar uploads de documentos no Cofre, a IA jamais deve atribuir valores padrão (como "Delta Plan" ou "Outros") caso não haja identificação inequívoca no documento. Campos não identificados devem permanecer vazios e o sistema deve obrigatoriamente solicitar o preenchimento ao usuário.
- **Tipos de documento dinâmicos:**
  O tipo de documento não deve ser restrito a listas fixas. A IA deve classificar pelo nome real do documento (Passaporte, Título de Eleitor, Contrato, Alvará, Nota Fiscal, Procuração, etc.). "Outros" só deve ser usado caso seja impossível classificar, gerando pergunta de confirmação.
- **Titularidade de documentos de identificação:**
  Para documentos pessoais/identificação (passaporte, RG, CNH, certidões), o titular deve ser extraído do nome que consta no próprio documento. Se esse nome não corresponder a nenhum titular previamente cadastrado, o sistema deve perguntar ao usuário se deseja cadastrar um novo titular.
- **Vinculação estrita por ID de cadastro:**
  Documentos se vinculam ao titular pelo ID do cadastro; o nome nunca é usado como chave. O agrupamento e a exibição de documentos devem usar obrigatoriamente o nome oficial do cadastro do titular, nunca o texto salvo no documento. Ao identificar o titular de um documento novo, se o nome casar com um titular já cadastrado (nome completo, primeiro nome ou apelido), o sistema deve vinculá-lo ao titular existente em vez de criar outro.

---

## 8. Bloqueio Rígido por Tipo Documental e Proibição de Entrega Divergente

- **Nunca entregar tipo divergente:**
  Se o tipo documental solicitado pelo usuário não existir no Cofre (ex.: certidão de nascimento quando só há certidão de casamento), o sistema jamais deve entregar documento de outro tipo. A resposta deve ser obrigatoriamente: `"Não encontrei esse documento no Cofre."`, listando opcionalmente os documentos que realmente existem daquele titular, sem nenhum anexo.
- **Tipos técnicos e titulares PJ:**
  O sistema deve reconhecer siglas e tipos técnicos oficiais (como ART e RRT) e partes significativas de pessoas jurídicas cadastradas (ex.: "Menegazzo" para "Serviços Menegazzo").

---

## 9. Tratamento de Resumos, Perguntas de Conteúdo e Listagem de Documentos

- **Resumos e perguntas sobre documento recém-entregue:**
  Mensagens como *"resuma esse documento em 10 linhas"*, *"o que esse documento fala sobre águas fluviais?"* ou *"explique esse documento"* logo após a VEGA entregar um anexo são **estritamente `pergunta_conteudo`**, nunca `pedir_arquivo`. A VEGA deve responder em texto sintetizando com base exclusiva no documento citado, **sem reenviar o anexo**.
- **Fatos documentais vs. Data de nascimento:**
  Perguntas sobre fatos históricos e jurídicos registrados em documentos (como data de dispensa do serviço militar ou data de registro de casamento) devem ser respondidas com o dado exato do fato (ex.: 23/08/2005 para dispensa militar; 12/04/2010 para registro de casamento), **nunca** substituindo pela data de nascimento.
- **Fallback vetorial para dados pessoais:**
  Se um dado do titular (ex.: endereço) não estiver estruturado na ficha cadastral, o motor deve consultar os trechos dos documentos do titular no Cofre (ex.: `Dados Thomaz`), responder com base no trecho oficial e oferecer o documento de onde extraiu.
- **Listagem de acervo ("o que tem no cofre?"):**
  Perguntas genéricas de catálogo devem classificar como `listar_documentos` e apresentar a lista organizada dos documentos disponíveis por titular, perguntando qual o usuário gostaria de consultar ou receber, sem disparar anexos soltos.

---

## 10. Tratamento de Documentos Faltantes e Inexistentes no Cofre

- **Registro Obrigatório e Acúmulo de Contagem:**
  Sempre que um documento solicitado não existir no Cofre, a VEGA deve registrar imediatamente o pedido na tabela `documentos_faltantes` do Supabase. Se o mesmo pedido já existir para aquele titular e tipo, o sistema deve somar na contagem (`quantidade_pedidos`) e atualizar a data do último pedido, sem duplicar o registro.
- **Estrutura Obrigatória da Resposta ao Usuário:**
  Quando o documento não existir, a resposta da VEGA deve seguir estritamente esta ordem:
  1. `"Não encontrei [artigo] *[Tipo do Documento]* d[prep] *[Titular]* no Cofre."` (com a saudação incorporada no início se o usuário saudou).
  2. `"Anotei na lista de documentos pendentes."`
  3. Se o dado que a pessoa provavelmente quer estiver comprovadamente em outro documento daquele titular no Cofre, oferecer: `"Se precisar só d[a/o] [dado], [ela/ele] consta n[a/o] [Documento]. Quer que eu informe?"`.
  4. **Proibição de promessas falsas:** Só oferecer o dado se ele realmente existir nos documentos do titular; nunca prometer ou inventar o que não tem.
  5. **Proibição de despejo de lista:** Nunca despejar a lista completa de documentos disponíveis do titular na resposta de um pedido pontual de documento inexistente. A lista só é apresentada se o usuário pedir expressamente ou em intenções de listagem de catálogo.
- **Baixa Automática:**
  Quando um documento for adicionado ao Cofre (via painel, segundo plano ou WhatsApp), todos os itens pendentes correspondentes na tabela `documentos_faltantes` devem ser marcados como providenciados automaticamente.

---

## 11. Integridade de Conversas do WhatsApp e Exibição no Painel

- **Gravação Obrigatória e Irrestrita:**
  Toda mensagem enviada ou recebida pelo WhatsApp deve ser gravada na conversa e ser exibível no painel. Nenhum fluxo ou caminho (texto, áudio, documentos/fotos recebidos, conhecimento estruturado como PIX/link/contato, listagem de documentos, documentos faltantes, pendências de upload, mensagens informativas ou correções de ficha) pode responder ou interagir no WhatsApp sem registrar o par de mensagens (remetente e VEGA) no histórico da conversa no Supabase.
- **Exibição Rica e Sem Ocultação:**
  O painel web deve renderizar com fidelidade cada formato:
  - Links navegáveis e interativos clicáveis (`target="_blank"`).
  - Áudios recebidos (player com reprodução e transcrição).
  - Documentos enviados pela VEGA (card com nome do arquivo, abrir e baixar).
  - Documentos e imagens recebidos do usuário (miniatura para imagens, card para PDF, com abrir e baixar).
  - Itens estruturados (PIX com botão copiar chave, link de sistema com botão acessar/copiar, contatos).
- **Proibição de Bolha Invisível ou Vazia:**
  Nada pode ficar invisível. Caso seja recebido um tipo desconhecido ou mensagem vazia de texto, a interface deve exibir um card/aviso discreto e legível com o horário, jamais uma bolha vazia ou nada.

---

## 12. Tratamento de Documentos PDF Protegidos por Senha

- **Detecção preventiva e status próprio:**
  PDFs protegidos por senha devem ser detectados preventivamente antes de qualquer tentativa de extração de texto ou OCR. Devem receber o status `status_indexacao = 'protegido_senha'` e o selo próprio **"Protegido por senha"** (ícone de cadeado âmbar/dourado), nunca sendo tratados como erro genérico ("NÃO INDEXADO").
- **Mensagem oficial obrigatória no Painel e WhatsApp:**
  `"Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele."`
- **Destravamento com senha e não retenção absoluta:**
  O sistema deve permitir que o usuário informe a senha do arquivo no painel para destravar a leitura. Ao receber a senha, deve abrir o PDF, extrair o texto vetorial e indexar normalmente. **A senha deve ser utilizada exclusivamente em memória e JAMAIS guardada em nenhum lugar** (nem no banco de dados, nem em arquivos locais, metadados ou logs).
