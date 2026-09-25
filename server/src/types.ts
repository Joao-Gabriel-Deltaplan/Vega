export type SetorUsuario =
  | 'Diretoria'
  | 'Administrativo'
  | 'Obras'
  | 'Financeiro'
  | 'Suprimentos'
  | 'RH'
  | 'Comercial';

export type NivelAcesso = 'diretoria' | 'geral';
export type VisibilidadeDoc = 'diretoria' | 'geral';
export type MotivoBuscaSemResultado =
  | 'inexistente'
  | 'sem_permissao'
  | 'loop'
  | 'inexistente_com_equivalente'
  | 'inexistente_documento'
  | 'inexistente_conhecimento';

export type TipoConhecimento = 'pix' | 'link' | 'contato' | 'regra';

export interface DadosPix {
  titular: string;
  tipoChave: 'CNPJ' | 'CPF' | 'Celular' | 'E-mail' | 'Aleatória';
  chave: string;
  banco?: string;
}

export interface DadosLink {
  nomeSistema: string;
  link: string;
  finalidade?: string;
}

export interface DadosContato {
  nome: string;
  funcao?: string;
  telefone?: string;
  email?: string;
}

export interface ItemConhecimento {
  id: string;
  titulo: string;
  categoria: string;
  conteudo: string;
  tipo?: TipoConhecimento;
  dadosEstruturados?: DadosPix | DadosLink | DadosContato | Record<string, any>;
  dataAtualizacao: string;
  dataCadastro?: string;
}

export interface Anexo {
  tipo: 'imagem' | 'pdf' | 'arquivo';
  url: string;
  nome: string;
  titulo?: string;
  titular?: string;
  dataCadastro?: string;
  tamanho?: string;
  base64?: string;
  mimeType?: string;
  visibilidade?: VisibilidadeDoc;
}

export interface OpcaoDocumento {
  id: string;
  titulo: string;
}

export interface DadosEstruturadosMensagem {
  tipo: 'pix' | 'link' | 'contato' | 'regra';
  titulo: string;
  conteudo?: string;
  chavePix?: string;
  tipoChavePix?: string;
  titularPix?: string;
  bancoPix?: string;
  link?: string;
  telefone?: string;
  setor?: string;
}

export interface Mensagem {
  id: string;
  remetente: 'cliente' | 'assistente';
  nomeRemetente: string;
  horario: string;
  texto: string;
  anexos?: Anexo[];
  origem?: 'motor' | 'ia';
  opcoes?: OpcaoDocumento[];
  documentoOferecidoId?: string;
  correcaoPendente?: CorrecaoPendenteFicha;
  rastroId?: string;
  rastro?: RastroRegistro;
  tipoMensagem?: 'texto' | 'audio' | 'documento' | 'imagem' | 'sistema';
  duracaoAudioSegundos?: number;
  audioOriginal?: boolean;
  audioStoragePath?: string;
  audioMimeType?: string;
  audioExpirado?: boolean;
  timestamp?: string;
  dadosEstruturados?: DadosEstruturadosMensagem;
}

export interface FichaContato {
  cargo: string;
  setor: SetorUsuario;
  nivelAcesso: NivelAcesso;
  observacoes: string;
  titularVinculado?: string;
}

export interface DocumentoRegistro {
  id: string;
  titulo: string;
  arquivo: string;
  tipo?: string;
  titular?: string;
  pessoaId?: string | null;
  pessoa_id?: string | null;
  descricao?: string;
  apelidos?: string[];
  visibilidade: VisibilidadeDoc;
  tamanho?: string;
  dataCadastro?: string;
  statusIndexacao?: 'processando' | 'indexado' | 'pendente' | 'erro' | 'substituido' | 'protegido_senha';
  erroIndexacao?: string;
  dataValidade?: string | null;
  origemValidade?: 'extraído automaticamente' | 'corrigido pelo chat' | 'manual';
  historicoValidade?: HistoricoCorrecaoCampo;
  silenciarAlertas?: boolean;
  trechoValidade?: string | null;
  storagePath?: string;
  metadata?: Record<string, any>;
}

export type StatusAlertaVencimento = 'a_vencer' | 'vence_hoje' | 'vencido';
export type PrazoAlerta = 60 | 30 | 7 | 0 | 'vencido_semanal';

export interface AlertaVencimento {
  id: string;
  documentoId: string;
  documentoTitulo: string;
  titular?: string;
  dataValidade: string; // Formato DD/MM/AAAA
  diasRestantes: number;
  status: StatusAlertaVencimento;
  prazoAlerta: PrazoAlerta;
  dataGeracao: string; // ISO String
  lido: boolean;
  notificadoWhatsApp?: boolean;
}

export type CampoTitularId =
  | 'nome'
  | 'rg'
  | 'orgaoEmissor'
  | 'cpf'
  | 'dataNascimento'
  | 'estadoCivil'
  | 'profissao'
  | 'endereco'
  | 'nacionalidade'
  | 'filiacao'
  | 'cnh'
  | 'categoriaCnh'
  | 'validadeCnh';

export interface HistoricoCorrecaoCampo {
  valorAnterior: string;
  valorNovo: string;
  corrigidoPor: string;
  dataHora: string;
}

export interface CampoTitular {
  valor: string;
  origem: string;
  origemNome?: string;
  origemVisibilidade?: VisibilidadeDoc;
  conferido: boolean;
  dataConferencia?: string;
  manual?: boolean;
  historicoCorrecao?: HistoricoCorrecaoCampo;
}

export interface CorrecaoPendenteFicha {
  titularId: string;
  titularNome: string;
  campoId: CampoTitularId | 'silenciar_alerta';
  campoLabel: string;
  valorAnterior: string;
  valorNovo: string;
  documentoId?: string;
  documentoTitulo?: string;
}

export interface FichaTitular {
  id: string;
  nome: string;
  apelidos?: string[];
  campos: Partial<Record<CampoTitularId, CampoTitular>>;
  atualizadoEm: string;
}

export interface AnaliseDocumentoResponse {
  tituloSugerido: string;
  tipoSugerido: string;
  titularSugerido: string;
  nomeNoDocumento?: string | null;
  novoTitularSugerido?: boolean;
  apelidosSugeridos: string[];
  visibilidadeSugerida: VisibilidadeDoc;
  descricaoSugerida: string;
  camposSugeridosTitular?: Partial<Record<CampoTitularId, string>>;
  dataValidadeSugerida?: string | null;
  protegidoPorSenha?: boolean;
}

export interface BuscaSemResultadoRegistro {
  id: string;
  data: string;
  contatoId: string;
  contatoNome: string;
  textoDoPedido: string;
  motivo: MotivoBuscaSemResultado;
  iaAcionada?: boolean;
  equivalenteOferecido?: string;
}

export type StatusDocumentoFaltante = 'pendente' | 'providenciado' | 'dispensado';

export interface DocumentoFaltanteRegistro {
  id: string;
  tipoDocumento: string;
  titular: string;
  pessoaId?: string | null;
  solicitanteNome: string;
  solicitanteContato?: string | null;
  quantidadePedidos: number;
  dataPrimeiroPedido: string;
  dataUltimoPedido: string;
  status: StatusDocumentoFaltante;
  observacao?: string | null;
  dadosEquivalentesOferecidos?: string | null;
  criadoEm?: string;
  atualizadoEm?: string;
}

export interface Contato {
  id: string;
  nome: string;
  telefone: string;
  avatarCor: string;
  cargo?: string;
  setor?: SetorUsuario;
  nivelAcesso?: NivelAcesso;
  titularVinculado?: string;
  ficha: FichaContato;
}

export interface Conversa {
  id: string;
  contato: Contato;
  naoLidas: number;
  ultimaAtualizacao: string;
  mensagens: Mensagem[];
}

export type MotivoUsoIA =
  | 'interpretacao'
  | 'equivalencia'
  | 'conversa'
  | 'transcricao_audio'
  | 'chat_classificador'
  | 'chat_resposta_trechos'
  | 'chat_resumo_conhecimento'
  | 'chat_fallback_vetorial'
  | 'chat_pergunta_documento_entregue'
  | 'indexacao_ocr_visao'
  | 'indexacao_embedding'
  | 'indexacao_extracao_ficha'
  | 'busca_embedding'
  | 'whatsapp_pendencia_duplicidade'
  | 'whatsapp_pendencia_titular'
  | 'whatsapp_pendencia_completar'
  | 'whatsapp_pendencia_correcao'
  | 'conhecimento_estruturacao'
  | string;

export interface RegistroUsoIA {
  id: string;
  data: string; // ISO
  provedor: string;
  modelo: string;
  contatoId?: string;
  contatoNome?: string;
  motivo: MotivoUsoIA;
  tokensEntrada: number;
  tokensSaida: number;
  custoEstimado: number;
  sucesso: boolean;
  erro?: string | null;
  estimado?: boolean;
}

export interface ConfigPrecoModelo {
  precoEntradaPorMilhao: number;
  precoSaidaPorMilhao: number;
  precoPorMinutoAudio?: number;
  moeda: string;
}

export type TabelaPrecos = Record<string, ConfigPrecoModelo>;

export interface ChamadasDia {
  data: string;
  chamadas: number;
}

export interface MetricaOrigemUsoIA {
  chave: 'chat' | 'transcricao_audio' | 'indexacao' | 'ocr' | 'embeddings' | 'testes' | 'outros';
  nome: string;
  custoUsd: number;
  custoBrl: number;
  chamadas: number;
  tokens: number;
  percentual: number;
  cor: string;
}

export interface MetricaPessoaUsoIA {
  contatoId: string;
  contatoNome: string;
  chamadas: number;
  custoUsd: number;
  custoBrl: number;
  tokens: number;
  custoMedioUsd: number;
  custoMedioBrl: number;
  percentual: number;
}

export interface PontoGraficoUsoIA {
  data: string;
  diaMes: string;
  custoUsd: number;
  custoBrl: number;
  chamadas: number;
  tokens: number;
}

export interface MetricasUsoIA {
  // Gasto e Consumo do Mês Atual (Fuso de Brasília)
  gastoMesUsd: number;
  gastoMesBrl: number;
  requisicoesMes: number;
  tokensEntradaMes: number;
  tokensSaidaMes: number;
  totalTokensMes: number;

  // Limite OpenAI e Alertas Visuais
  limiteMensalUsd: number;
  percentualLimiteMensal: number;
  alerta50: boolean;
  alerta80: boolean;
  limiteExcedido: boolean;

  // Cotação do Dólar Fixa Configurável
  cotacaoDolar: number;

  // Data a partir da qual o registro de telemetria é 100% completo e unificado
  dataInicioRegistroCompleto?: string;

  // Custo Médio por Mensagem Respondida e por Requisição
  totalMensagensRespondidasMes: number;
  custoMedioPorMensagemUsd: number;
  custoMedioPorMensagemBrl: number;
  custoMedioPorRequisicaoUsd: number;
  custoMedioPorRequisicaoBrl: number;

  // Gráfico Diário dos Últimos 30 Dias (Fuso de Brasília)
  grafico30Dias: PontoGraficoUsoIA[];

  // Divisão por Origem
  divisaoOrigens: MetricaOrigemUsoIA[];

  // Divisão por Pessoa (WhatsApp)
  divisaoPessoas: MetricaPessoaUsoIA[];

  // Compatibilidade com telas e lógicas legadas
  requisicoesHoje: number;
  limiteRPD: number;
  percentualRPD: number;
  alertaRPD: boolean;

  requisicoesUltimoMinuto: number;
  limiteRPM: number;
  alertaRPM: boolean;

  percentualSemIA30d: number;
  totalMensagens30d: number;
  mensagensSemIA30d: number;

  custoEstimadoMes: number;
  moeda: string;
  isFreeTier: boolean;
  tetoCustoMensal: number;
  tetoExcedido: boolean;

  chamadasUltimos30Dias: ChamadasDia[];

  motivos: {
    interpretacao: number;
    equivalencia: number;
    conversa: number;
    transcricao_audio?: number;
  };

  ultimas50Chamadas: RegistroUsoIA[];
  tabelaPrecos: TabelaPrecos;
}

export interface EtapaRastro {
  ordem: number;
  nome: string;
  descricao: string;
  tempoMs: number;
  detalhes?: Record<string, any>;
}

export interface DocumentoRastro {
  id?: string;
  titulo: string;
  tipo?: string;
  similaridade?: number;
  pagina?: number;
  trecho?: string;
  usadoNaResposta: boolean;
}

export interface AnexoRastro {
  nome: string;
  titulo?: string;
  tamanho?: string;
  tipo: string;
}

export interface DetalhesCorrecaoRastro {
  campo: string;
  valorAnterior: string;
  valorNovo: string;
  titular: string;
  corrigidoPor?: string;
  dataHora?: string;
}

export interface RastroRegistro {
  id?: string;
  mensagemId: string;
  conversaId?: string;
  criadoEm?: string;
  usuarioNome: string;
  usuarioId?: string;
  mensagemOriginal: string;
  perguntaReescrita: string;
  intencaoDetectada: string;
  tipoBusca: string;
  documentosEncontrados: DocumentoRastro[];
  documentoUsado?: string;
  enviouAnexo: boolean;
  anexosDetalhes?: AnexoRastro[];
  respostaFinal: string;
  modeloUsado: string;
  tokensTotal: number;
  tokensPrompt: number;
  tokensCompletion: number;
  custoEstimadoUsd: number;
  tempoTotalMs: number;
  perguntaCompleta?: string;
  termoBusca?: string;
  pessoa?: string;
  origemPessoa?: 'mensagem_atual' | 'contexto';
  campos?: string[];
  documentoCitado?: string;
  detalhesCorrecao?: DetalhesCorrecaoRastro;
  tipoEntrada?: 'texto' | 'audio';
  transcricaoAudio?: {
    duracaoSegundos: number;
    custoUsd: number;
    modelo: string;
    metodoDownload?: string;
    textoOriginal?: string;
    textoCorrigido?: string;
    correcoesAplicadas?: Array<{ de: string; para: string; motivo: string }>;
  };
  etapas: EtapaRastro[];
}

export type CategoriaDocumentoEsperado = 'PF' | 'PJ';

export interface DocumentoEsperado {
  id: string;
  nome: string;
  categoria: CategoriaDocumentoEsperado;
  obrigatorio: boolean;
  camposFornecidos: string[];
  ativo: boolean;
  ordem: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentoEsperadoDispensa {
  id: string;
  titularId: string;
  documentoEsperadoId: string;
  motivo?: string | null;
  criadoEm: string;
}

export type SituacaoChecklistDocumento = 'completo' | 'so_o_dado' | 'faltando' | 'nao_se_aplica';

export interface ItemChecklistDocumento {
  documentoEsperado: DocumentoEsperado;
  situacao: SituacaoChecklistDocumento;
  documentoCofre?: {
    id: string;
    titulo: string;
    arquivo: string;
    tipo?: string;
    dataCadastro?: string;
  };
  dadosFicha?: Array<{
    campo: string;
    valor: string;
    origem?: string;
    origemNome?: string;
  }>;
  dispensa?: {
    id: string;
    motivo?: string | null;
    criadoEm: string;
  };
  solicitadoNoWhatsApp?: boolean;
  quantidadePedidosWhatsApp?: number;
  dataUltimoPedidoWhatsApp?: string;
  prioridade?: boolean;
}

export interface ChecklistTitularResultado {
  titular: {
    id: string;
    nome: string;
    apelidos?: string[];
    categoria: CategoriaDocumentoEsperado;
  };
  itens: ItemChecklistDocumento[];
  estatisticas: {
    totalEsperados: number;
    totalAplicaveis: number;
    completos: number;
    soODado: number;
    faltando: number;
    dispensados: number;
    prioritarios: number;
    percentualCompletude: number;
    percentualArquivos: number;
    textoCompletude: string;
  };
}

// ==========================================
// AVISOS DE FALHA E DE CONSUMO DO SISTEMA
// ==========================================

export type TipoAviso =
  | 'openai_erro'
  | 'consumo_limite'
  | 'evolution_falha'
  | 'supabase_falha'
  | 'indexacao_falha'
  | 'transcricao_falha'
  | 'recuperacao';

export type SeveridadeAviso = 'critico' | 'alerta' | 'informativo' | 'critica' | 'alta' | 'media' | 'baixa';

export type StatusAviso = 'ativo' | 'resolvido' | 'lido';

export interface AvisoSistemaRegistro {
  id: string;
  tipo: TipoAviso;
  severidade: SeveridadeAviso;
  origem: string;
  titulo: string;
  mensagem: string;
  detalheTecnico?: string | null;
  chaveAgrupamento: string;
  quantidadeOcorrencias: number;
  primeiraOcorrencia: string;
  ultimaOcorrencia: string;
  status: StatusAviso;
  enviadoWhatsapp: boolean;
  destinatariosWhatsapp?: string[];
  criadoEm: string;
  atualizadoEm: string;
}

export interface ConfiguracaoAvisos {
  id: string;
  destinatariosWhatsapp: string[];
  limiteMensalUsd: number;
  notificar50Porcento: boolean;
  notificar80Porcento: boolean;
  notificar100Porcento: boolean;
  tiposAtivos: TipoAviso[];
  faixasNotificadasMesAtual: Record<string, number[]>;
  criadoEm?: string;
  atualizadoEm?: string;
}

