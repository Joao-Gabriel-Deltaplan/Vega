# Delta Plan • Painel de Atendimento Web com IA

Painel de atendimento web no estilo WhatsApp Business (3 colunas, tema escuro) para testes operacionais com assistente inteligente de IA da **Delta Plan**.

---

## 🚀 Portas Utilizadas
- **Frontend (React + Vite + Tailwind):** `http://localhost:4300` (porta `4300`, configurada com `strictPort: true` e proxy para `/api` e `/arquivos`)
- **Backend (Node + Express + TypeScript):** `http://localhost:4301` (porta `4301`, CORS liberado para porta `4300`)

---

## 🛠️ Pré-requisitos
- Node.js instalado (v18+)

---

## ⚡ Instalação Rápida

Na raiz do projeto, instale as dependências da raiz, do servidor e do cliente com um único comando:

```bash
npm run install:all
```

*(Ou manualmente: `npm install`, `cd server && npm install`, `cd ../client && npm install`)*

---

## 🔑 Configuração da Anthropic API (Opcional para testes)

No arquivo `.env` na raiz do projeto:

```env
PORT=4301
VITE_PORT=4300
ANTHROPIC_API_KEY=sua_chave_anthropic_aqui
```

> **Dica:** Se você não configurar a chave `ANTHROPIC_API_KEY` de imediato, o sistema entrará automaticamente em **modo simulador de atendimento Delta Plan**, permitindo testar toda a interface, streaming em tempo real, envio de arquivos e geração de PDFs sem quebrar.

---

## ▶️ Como Rodar (Front e Back Juntos)

Execute o comando único na raiz do projeto:

```bash
npm run dev
```

Esse comando usará o `concurrently` para subir o backend e o frontend simultaneamente:
- Acesse seu navegador em: **[http://localhost:4300](http://localhost:4300)**

---

## ✨ Recursos Inclusos

1. **Barra Lateral de Navegação (Extremo Esquerdo ~64px)**:
   - 💬 **Atendimento / Conversas:** Abre o painel completo de 3 colunas no estilo WhatsApp Business (lista de conversas, chat ao vivo e ficha do contato).
   - 🧠 **Ensinar a IA (Base de Conhecimento):** Área dedicada para registrar novas instruções, informações corporativas, regras de negócio e conteúdos para o assistente aprender.
   - ⚙️ **Painel Admin:** Controle de parâmetros do modelo de IA (Anthropic Claude, temperatura, tokens máximos), status dos servidores e métricas operacionais.

2. **Layout de 3 Colunas (WhatsApp Business Dark)**:
   - **Esquerda (~300px):** Lista de conversas com busca por nome/telefone, avatares coloridos dinâmicos, prévia da última mensagem, badges de não lidas e botão **"Nova conversa de teste"**.
   - **Central (flex-1):** Thread da conversa com status "ao vivo", bolhas diferenciadas (cliente à esquerda em `#202c33`, assistente à direita em `#005c4b`), horário e nome do remetente.
   - **Direita (~280px):** Ficha cadastral editável (Interesse, Agendou?, Primeiro contato, Observações com persistência em JSON), **Etapa do Funil interativa** em barra de progresso *(Só entrou > Qualificando > Proposta > Agendado > Fechado)* e lista de agendamentos.
2. **Streaming em Tempo Real (SSE)**:
   - Respostas do assistente transmitidas em streaming via Server-Sent Events com histórico completo da conversa e system prompt de `prompts/assistente.md`.
3. **Envio de Arquivos**:
   - Botão de clipe permitindo enviar PDFs e imagens convertidos em base64 (`type: document` e `type: image`) para o Claude.
4. **Geração Automática de PDFs**:
   - Blocos ````pdf { titulo, conteudo_markdown } ```` gerados pelo assistente são convertidos automaticamente em PDF real com `pdfkit`, salvos em `/arquivos` e exibidos com botão de download no chat.
5. **Voz (Entrada e Saída em pt-BR)**:
   - **Microfone:** Grava e transcreve a fala do usuário via Web Speech API (`SpeechRecognition`) direto no campo de texto.
   - **Alto-falante:** Botão de áudio em cada mensagem do assistente que sintetiza a fala (`SpeechSynthesis`) em voz pt-BR com player de play/pause e barra de progresso.
6. **Persistência Local**:
   - Conversas em memória e salvas automaticamente em `data/conversas.json`.
