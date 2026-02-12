import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';

// Configuração __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🛠️  Iniciando teste de diagnóstico...");

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'data', '.test_session') }),
    authTimeoutMs: 60000,
    puppeteer: {
        headless: false, // Importante para ver o que acontece
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--disable-session-crashed-bubble',
            '--disable-dev-shm-usage',
            '--no-default-browser-check'
        ]
    }
});

console.log("⏳ Inicializando cliente...");

client.on('qr', (qr) => {
    console.log('✅ QR Code GERADO! O problema não é na conexão básica.');
    console.log('Cole este QR Code em um gerador se precisar, ou apenas observe se a tela carregou.');
    // Opcional: imprimir QR no terminal se quiser, mas o foco é saber se CHEGA aqui
});

client.on('ready', () => {
    console.log('✅ Cliente PRONTO! Conexão bem sucedida.');
    process.exit(0);
});

client.on('authenticated', () => {
    console.log('✅ Autenticado!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Carregando: ${percent}% - ${message}`);
});

client.on('disconnected', (reason) => {
    console.log('❌ Desconectado:', reason);
});

// Captura logs internos do navegador
client.on('message_create', (msg) => {
    if (msg.fromMe) console.log("Mensagem enviada detectada");
});

// Inicialização com tratamento de erro global
try {
    client.initialize().catch(err => {
        console.error("❌ Erro fatal no initialize:", err);
    });
} catch (e) {
    console.error("❌ Erro síncrono:", e);
}
