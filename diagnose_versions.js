import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAX_ATTEMPTS = 3;

const testConfigs = [
    {
        name: "REMOTO STABLE (2.2403.2)",
        options: {
            authTimeoutMs: 60000,
            webVersionCache: {
                type: "remote",
                remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/463811a9a85c3dd3fa1bc1d5eda3ce365f22f727/html/2.2403.2.html"
            }
        }
    },
    {
        name: "SEM CACHE (padrão)",
        options: {
            authTimeoutMs: 60000,
            webVersionCache: undefined // remove config
        }
    },
    {
        name: "REMOTO ALPHA (2.3000...)",
        options: {
            authTimeoutMs: 60000,
            webVersionCache: {
                type: "remote",
                remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1033328157-alpha.html"
            }
        }
    },
    {
        name: "COMPATIBILIDADE FORÇADA (Local)",
        options: {
            authTimeoutMs: 60000,
            webVersionCache: {
                type: "local" // se existir, senão pode falhar
            }
        }
    }
];

const puppeteerConfig = {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-session-crashed-bubble',
        '--disable-dev-shm-usage',
        '--no-default-browser-check',
        '--disable-extensions' // Garante isolamento da extensão
    ]
};

async function runTest(config) {
    console.log(`\n🧪 TESTANDO CONFIGURAÇÃO: ${config.name}`);
    const sessionDir = path.join(__dirname, 'data', `.test_session_${config.name.replace(/\s+/g, '_')}`);

    // Limpa sessão anterior
    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionDir }),
        ...config.options,
        puppeteer: puppeteerConfig
    });

    return new Promise((resolve) => {
        let success = false;

        const timeout = setTimeout(async () => {
            if (!success) {
                console.log(`❌ ${config.name}: TIMEOUT (60s) sem QR Code ou Auth.`);
                await client.destroy().catch(() => { });
                resolve(false);
            }
        }, 60000);

        client.on('qr', async (qr) => {
            console.log(`✅ ${config.name}: SUCECESSO! QR Code gerado.`);
            success = true;
            clearTimeout(timeout);
            await client.destroy().catch(() => { });
            resolve(true); // Funciona!
        });

        client.on('authenticated', async () => {
            console.log(`✅ ${config.name}: SUCECESSO! Autenticado (sessão recuperada).`);
            success = true;
            clearTimeout(timeout);
            await client.destroy().catch(() => { });
            resolve(true);
        });

        client.on('auth_failure', (msg) => {
            console.log(`❌ ${config.name}: Falha de autenticação: ${msg}`);
        });

        client.initialize().catch(e => {
            console.log(`❌ ${config.name}: Erro ao inicializar: ${e.message}`);
        });
    });
}

(async () => {
    console.log("🚀 Iniciando Bateria de Testes de Conexão...");

    for (const config of testConfigs) {
        // Pula o terceiro se não tiver HTML local baixado, mas ok tentar
        if (config.name.includes("Local")) continue;

        try {
            const passed = await runTest(config);
            if (passed) {
                console.log(`\n🎉🎉🎉 SOLUÇÃO ENCONTRADA: ${config.name}`);
                console.log("Reconfigure o seu index.js com estas opções.");
                process.exit(0); // Para no primeiro que funcionar
            }
        } catch (e) {
            console.error(e);
        }
    }

    console.log("\n⚠️ Nenhum teste passou automaticamente. Verifique os logs e tente manualmente.");
    process.exit(1);
})();
