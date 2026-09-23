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

export interface UsuarioAutorizado {
  id: string;
  numero: string;
  lid?: string | null;
  nome: string;
  perfil: 'admin' | 'comum';
  pessoa_id?: string | null;
  nomeTitularVinculado?: string | null;
  ativo: boolean;
  dataCadastro?: string;
  createdAt?: string;
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
}

export interface BuscaSemResultadoRegistro {
  id: string;
  data: string;
  contatoId: string;
  contatoNome: string;
  textoDoPedido: string;
  motivo:
    | 'inexistente'
    | 'sem_permissao'
    | 'loop'
    | 'inexistente_com_equivalente'
    | 'inexistente_documento'
    | 'inexistente_conhecimento';
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

export type MotivoUsoIA = 'interpretacao' | 'equivalencia' | 'conversa' | 'transcricao_audio';

export interface RegistroUsoIA {
  id: string;
  data: string; // ISO
  provedor: string;
  modelo: string;
  contatoId: string;
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

export interface MetricasUsoIA {
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

  tokensEntradaMes: number;
  tokensSaidaMes: number;
  totalTokensMes: number;

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
  };
  etapas: EtapaRastro[];
}
