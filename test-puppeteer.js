import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

console.log('🧪 Teste 1: Abrindo Chrome headless...');

try {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    console.log('✅ Chrome aberto com sucesso!');

    console.log('🧪 Teste 2: Navegando para WhatsApp Web...');
    const page = await browser.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('✅ WhatsApp Web carregado!');
    console.log('📄 Título da página:', await page.title());

    await browser.close();
    console.log('\n✅ TODOS OS TESTES PASSARAM! O problema não é com o Puppeteer.');
    console.log('   O problema deve estar na biblioteca whatsapp-web.js.');

} catch (error) {
    console.error('\n❌ ERRO:', error.message);
    console.log('\n💡 Diagnóstico:');
    if (error.message.includes('timeout')) {
        console.log('   - O Chrome está demorando demais para responder');
        console.log('   - Possível firewall ou problema de rede');
    } else if (error.message.includes('Failed to launch')) {
        console.log('   - Chrome não conseguiu iniciar');
        console.log('   - Verifique o caminho: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    } else {
        console.log('   - Erro desconhecido. Veja detalhes acima.');
    }
}
