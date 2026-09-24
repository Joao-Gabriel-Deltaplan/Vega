import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Redireciona para o teste atualizado de validade de contexto por mensagens (Regra 15)
import './testar_validade_contexto_mensagens.js';
