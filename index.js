import express from "express";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

// Configuração para __dirname em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const PORT = process.env.PORT || 3001;
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "store.json");
const uploadsDir = path.join(dataDir, "uploads");

// Garante que diretórios existam
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// --- FIX PARA CRASH RECOVERY (Evita popup "Restaurar páginas") ---
const fixCrashPreferences = () => {
  const sessionDir = path.join(dataDir, ".wwebjs_auth/session/Default");
  const preferencesPath = path.join(sessionDir, "Preferences");

  if (fs.existsSync(preferencesPath)) {
    try {
      const content = fs.readFileSync(preferencesPath, 'utf8');
      const prefs = JSON.parse(content);

      let modified = false;
      if (prefs.profile) {
        if (prefs.profile.exit_type !== 'Normal') {
          prefs.profile.exit_type = 'Normal';
          modified = true;
        }
        if (prefs.profile.exited_cleanly !== true) {
          prefs.profile.exited_cleanly = true;
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(preferencesPath, JSON.stringify(prefs));
        console.log("⚠️ Preferências do Chrome corrigidas para evitar popup de restauração.");
      }
    } catch (e) {
      console.error("Erro ao tentar corrigir preferências do Chrome:", e);
    }
  }
};

// Corrige antes de iniciar
fixCrashPreferences();
// ----------------------------------------------------------------

// Funções utilitárias e variáveis globais
const loadStore = () => {
  if (!fs.existsSync(dataFile)) return { replies: [], schedules: [], sentLog: [], uploads: [], campaigns: [], tags: [], contactTags: {}, funnel: {} };
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return { replies: [], schedules: [], sentLog: [], uploads: [], campaigns: [], tags: [], contactTags: {}, funnel: {} };
  }
};

const saveStore = (store) => {
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
};

let latestQr = null;
let clientReady = false;
let lastAuthError = null;
let client = null;

// Graceful Shutdown para evitar corromper sessão
const shutdown = async () => {
  console.log('\nEncerrando servidor...');
  if (client) {
    try {
      await client.destroy();
      console.log('Cliente WhatsApp encerrado corretamente.');
    } catch (e) {
      console.error('Erro ao encerrar cliente:', e);
    }
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Middleware de autenticação simplificado (pass-through)
const authMiddleware = (req, res, next) => {
  // Verifica token apenas se desejar strict mode, mas por padrão agora é aberto/local
  // const token = req.headers["x-access-token"];
  // if (process.env.AUTH_TOKEN && token !== process.env.AUTH_TOKEN) return res.status(403).json({ error: "forbidden" });
  next();
};

const validateStringFields = (fields) => (req, res, next) => {
  if (!req.body) return res.status(400).json({ error: "missing_body" });
  for (const field of fields) {
    if (typeof req.body[field] !== 'string' || !req.body[field].trim()) {
      return res.status(400).json({ error: `missing_or_invalid_${field}` });
    }
  }
  next();
};

async function startServer() {
  // Garante que o cliente anterior seja destruído antes de criar um novo
  if (client) {
    try { await client.destroy(); } catch (e) { }
    client = null;
  }

  console.log("Iniciando cliente WhatsApp...");

  // Usando WPPConnect ao invés de whatsapp-web.js
  console.log('🔄 Criando cliente WPPConnect...');
  client = await wppconnect.create({
    session: 'emidia-session',
    headless: false, // Mudado para abrir Chrome visível
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    autoClose: 0,
    catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
      console.log('\n✅ QR Code gerado com sucesso!');
      console.log('📱 Abra seu navegador e acesse: http://localhost:' + PORT + '/qr');
      console.log('   Escaneie o QR Code para conectar\n');
      latestQr = base64Qr;
    },
    statusFind: (statusSession, session) => {
      console.log(`🔄 Status: ${statusSession}`);
      if (statusSession === 'isLogged') {
        console.log('✅ Cliente WhatsApp conectado e pronto!');
        clientReady = true;
        latestQr = null;
      } else if (statusSession === 'qrReadFail' || statusSession === 'qrReadError') {
        console.log('❌ Falha ao ler QR Code');
        lastAuthError = 'QR Code inválido ou expirado';
        clientReady = false;
      } else if (statusSession === 'notLogged') {
        clientReady = false;
      } else if (statusSession === 'browserClose' || statusSession === 'serverClose') {
        console.log('Cliente desconectado:', statusSession);
        clientReady = false;
        // Attempt to restart or re-initialize if browser/server closes unexpectedly
        console.log("♻️ Tentando reiniciar serviço após desconexão...");
        startServer();
      } else if (statusSession === 'autocloseCalled') {
        console.log('Cliente desconectado por autoclose:', statusSession);
        clientReady = false;
      } else if (statusSession === 'desconnectedMobile') {
        console.log('Cliente desconectado do celular:', statusSession);
        clientReady = false;
        // If mobile disconnects, session might be invalid, try to restart
        console.log("♻️ Tentando reiniciar serviço após desconexão do celular...");
        startServer();
      }
    }
  });

  console.log('✅ Cliente WPPConnect criado!');

  // Scheduler loop
  setInterval(async () => {
    if (!clientReady) return;

    const store = loadStore();
    const now = Date.now();
    // Pega pendentes com data vencida
    const pending = store.schedules.filter(s => s.status === "pending" && (!s.sendAt || s.sendAt <= now));

    if (pending.length === 0) return;

    console.log(`Processando ${pending.length} agendamentos pendentes...`);

    for (const sched of pending) {
      if (!podeEnviarHoje(store)) {
        console.warn("Limite diário atingido. Pausando envios.");
        break; // Para o processamento se limite atingido
      }

      try {
        const { numbers, message, uploadId } = sched;
        let media = null;

        if (uploadId) {
          const up = store.uploads.find(u => u.id === uploadId);
          if (up && fs.existsSync(up.path)) {
            const b64 = fs.readFileSync(up.path, { encoding: 'base64' });
            media = new MessageMedia(up.mime, b64, up.filename);
          }
        }

        // Garante que numbers é array
        const targets = Array.isArray(numbers) ? numbers : [];

        for (const n of targets) {
          const jid = `${String(n).replace(/\D/g, "")}@c.us`;

          // Simula presença (composing)
          await client.sendPresenceAvailable();
          await client.sendPresenceUpdate('composing', jid);
          await new Promise(r => setTimeout(r, Math.floor(Math.random() * 2000) + 3000)); // 3-5s

          // Varia mensagem (spintax)
          let msgFinal = message || "";
          msgFinal = spintax(msgFinal, { nome: n });

          if (media) {
            await client.sendMessage(jid, media, { caption: msgFinal });
          } else {
            await client.sendMessage(jid, msgFinal);
          }

          // Atualiza log de envios para controle de limite
          store.sentLog.unshift({
            id: `sched-${Date.now()}`,
            to: jid,
            message: msgFinal,
            campaignId: sched.campaignId,
            timestamp: Date.now()
          });
          store.sentLog = store.sentLog.slice(0, 500);

          // Jitter entre envios
          await new Promise(r => setTimeout(r, randomDelay()));
        }

        sched.status = "sent";
        sched.sentAt = Date.now();
      } catch (e) {
        console.error(`Erro ao processar agendamento ${sched.id}:`, e);
        sched.status = "failed";
        sched.sentAt = Date.now();
        sched.error = e.message;
      }
    }
    saveStore(store);
  }, 10000);
}

// ... Routes (mantendo as existentes e garantindo que authMiddleware esteja disponível) ...

app.get("/status", (_req, res) => {
  res.json({ ready: clientReady, hasQr: !!latestQr, authError: lastAuthError });
});

app.get("/qr", (_req, res) => {
  if (!latestQr) {
    if (clientReady) return res.send("<html><body><h2>Cliente já conectado!</h2></body></html>");
    res.status(404).send("QR code não pronto ainda. Aguarde...");
    return;
  }
  // Se latestQr já é base64 (dataURL), mostramos direto
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
    <html>
      <head><title>QR WhatsApp</title></head>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;">
        <div style="text-align:center;color:#fff;font-family:Arial;">
          <h2>Escaneie o QR no WhatsApp</h2>
          <img src="${latestQr}" alt="QR" style="width:320px;height:320px;" />
          <p>Atualize a página se expirar.</p>
        </div>
      </body>
    </html>
  `);
});

app.post("/upload", authMiddleware, validateStringFields(["filename", "base64", "mime"]), async (req, res) => {
  const { filename, base64, mime } = req.body || {};
  try {
    // Limita upload a 10MB (aumentado)
    const approxBytes = Math.floor((base64.length * 3) / 4);
    const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
    if (approxBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'upload_too_large' });
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(uploadsDir, `${id}-${safeName}`);
    await fs.promises.writeFile(filePath, Buffer.from(base64, "base64"));

    const store = loadStore();
    store.uploads.push({ id, filename: safeName, mime, path: filePath, createdAt: Date.now() });
    saveStore(store);

    res.json({ id });
  } catch (e) {
    console.error("Upload error:", e);
    res.status(500).json({ error: "upload_failed" });
  }
});

app.post("/schedule", authMiddleware, async (req, res) => {
  const { numbers, message, sendAt, uploadId, campaignId } = req.body || {};
  if (!Array.isArray(numbers) || numbers.length === 0 || !sendAt) {
    res.status(400).json({ error: "missing_schedule_data" });
    return;
  }
  const store = loadStore();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.schedules.push({
    id,
    numbers,
    message: message || "",
    sendAt, // Timestamp number
    uploadId: uploadId || null,
    campaignId: campaignId || null,
    status: "pending",
    createdAt: Date.now()
  });
  saveStore(store);
  res.json({ id });
});

app.get("/schedules", (_req, res) => {
  const store = loadStore();
  res.json({ schedules: store.schedules || [] });
});

app.get("/contacts", authMiddleware, async (_req, res) => {
  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });

    // We want a "real" target list: saved contacts + unsaved chats + groups
    const [contacts, chats] = await Promise.all([client.getContacts(), client.getChats()]);

    const map = new Map();

    const normalizeId = (id) => (typeof id === "string" ? id : (id && id._serialized) || "");
    const isValidTarget = (id) => {
      if (!id) return false;
      if (id === "status@broadcast") return false;
      if (id.endsWith("@broadcast")) return false;
      if (id.includes("newsletter")) return false;
      return id.endsWith("@c.us") || id.endsWith("@g.us");
    };

    // 1) Saved/known contacts
    for (const c of contacts || []) {
      const id = normalizeId(c.id);
      if (!isValidTarget(id)) continue;

      const isGroup = id.endsWith("@g.us");
      const number = id.endsWith("@c.us") ? (c.id && c.id.user) || id.split("@")[0] : "";

      map.set(id, {
        id,
        number,
        name: c.name || c.pushname || c.shortName || "",
        isGroup,
        isMyContact: !!c.isMyContact
      });
    }

    // 2) Chats (includes unsaved numbers + groups)
    for (const ch of chats || []) {
      const id = normalizeId(ch.id);
      if (!isValidTarget(id)) continue;

      const isGroup = !!ch.isGroup || id.endsWith("@g.us");
      const number = id.endsWith("@c.us") ? (ch.id && ch.id.user) || id.split("@")[0] : "";

      const existing = map.get(id) || { id, number, isGroup, isMyContact: false };
      map.set(id, {
        ...existing,
        // Chat name is often the best for groups and unsaved chats
        name:
          existing.name ||
          ch.name ||
          (ch.contact && (ch.contact.name || ch.contact.pushname)) ||
          (number ? `+${number}` : "Grupo")
      });
    }

    const contatos = Array.from(map.values())
      .sort((a, b) => (a.isGroup === b.isGroup ? (a.name || "").localeCompare(b.name || "") : a.isGroup ? 1 : -1));

    res.json({ contatos });
  } catch (e) {
    console.error("Contacts error:", e);
    res.status(500).json({ error: "contacts_failed" });
  }
});

app.get("/chats", authMiddleware, async (_req, res) => {
  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const chats = await client.getChats();
    const mapped = chats.map((c) => ({
      id: c.id?._serialized || "",
      name: c.name || c.formattedTitle || c.title || "",
      isGroup: !!c.isGroup,
      unreadCount: c.unreadCount || 0,
      lastMessage: c.lastMessage?.body || "",
      timestamp: c.lastMessage?.timestamp || null
    }));
    res.json({ chats: mapped });
  } catch (e) {
    console.error("Chats error:", e);
    res.status(500).json({ error: "chats_failed" });
  }
});

app.get("/replies", (_req, res) => {
  const store = loadStore();
  res.json({ replies: store.replies || [] });
});

app.get("/messages", authMiddleware, async (req, res) => {
  const { chatId } = req.query || {};
  if (!chatId) {
    res.status(400).json({ error: "missing_chatId" });
    return;
  }
  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const mapped = messages.map((m) => ({
      id: m.id?._serialized || "",
      body: m.body || "",
      fromMe: !!m.fromMe,
      timestamp: m.timestamp || null,
      hasMedia: !!m.hasMedia
    }));
    res.json({ messages: mapped });
  } catch (e) {
    console.error("Messages error:", e);
    res.status(500).json({ error: "messages_failed" });
  }
});

app.post("/send", authMiddleware, validateStringFields(["message"]), async (req, res) => {
  const { number, message, chatId, campaignId } = req.body || {};
  if ((!number && !chatId) || !message) {
    res.status(400).json({ error: "missing_target_or_message" });
    return;
  }

  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const target = chatId || `${number.replace(/\D/g, "")}@c.us`;
    const result = await client.sendMessage(target, message);
    const store = loadStore();
    store.sentLog.unshift({
      id: result.id?._serialized || "",
      to: target,
      message,
      campaignId: campaignId || null,
      timestamp: Date.now()
    });
    store.sentLog = store.sentLog.slice(0, 500);
    saveStore(store);
    res.json({ success: true, id: result.id?._serialized || null });
  } catch (e) {
    console.error("Send error:", e);
    res.status(500).json({ error: "send_failed" });
  }
});

app.post("/send-media", authMiddleware, validateStringFields(["mediaBase64", "mimetype"]), async (req, res) => {
  const { number, chatId, message, mediaBase64, mimetype, filename, campaignId } = req.body || {};
  if ((!number && !chatId) || !mediaBase64 || !mimetype) {
    res.status(400).json({ error: "missing_target_or_media" });
    return;
  }

  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const target = chatId || `${number.replace(/\D/g, "")}@c.us`;
    const media = new MessageMedia(mimetype, mediaBase64, filename || "arquivo");
    const result = await client.sendMessage(target, media, { caption: message || "" });
    const store = loadStore();
    store.sentLog.unshift({
      id: result.id?._serialized || "",
      to: target,
      message: message || "",
      campaignId: campaignId || null,
      timestamp: Date.now()
    });
    store.sentLog = store.sentLog.slice(0, 500);
    saveStore(store);
    res.json({ success: true, id: result.id?._serialized || null });
  } catch (e) {
    console.error("Send media error:", e);
    res.status(500).json({ error: "send_media_failed" });
  }
});

// Campaigns
app.get("/campaigns", (_req, res) => {
  const store = loadStore();
  res.json({ campaigns: store.campaigns || [] });
});

app.post("/campaigns", authMiddleware, (req, res) => {
  const { name, message, numbers, tag } = req.body || {};
  if (!name) {
    res.status(400).json({ error: "missing_campaign_name" });
    return;
  }
  const store = loadStore();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.campaigns.push({
    id,
    name,
    message: message || "",
    numbers: Array.isArray(numbers) ? numbers : [],
    tag: tag || null,
    createdAt: Date.now()
  });
  saveStore(store);
  res.json({ id });
});

// Tags
app.get("/tags", (_req, res) => {
  const store = loadStore();
  res.json({ tags: store.tags || [], contactTags: store.contactTags || {} });
});

app.post("/tags", authMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name) {
    res.status(400).json({ error: "missing_tag_name" });
    return;
  }
  const store = loadStore();
  if (!store.tags.includes(name)) store.tags.push(name);
  saveStore(store);
  res.json({ success: true });
});

app.post("/tags/apply", authMiddleware, (req, res) => {
  const { numbers, tags } = req.body || {};
  if (!Array.isArray(numbers) || !Array.isArray(tags)) {
    res.status(400).json({ error: "missing_tags_data" });
    return;
  }
  const store = loadStore();
  numbers.forEach((n) => {
    const num = String(n).replace(/\D/g, "");
    if (!num) return;
    store.contactTags[num] = Array.from(new Set([...(store.contactTags[num] || []), ...tags]));
  });
  saveStore(store);
  res.json({ success: true });
});

// Funnel
app.get("/funnel", (_req, res) => {
  const store = loadStore();
  res.json({ funnel: store.funnel || {} });
});

app.post("/funnel/update", authMiddleware, (req, res) => {
  const { number, stage } = req.body || {};
  if (!number || !stage) {
    res.status(400).json({ error: "missing_funnel_data" });
    return;
  }
  const store = loadStore();
  const num = String(number).replace(/\D/g, "");
  store.funnel[num] = { stage, updatedAt: Date.now() };
  saveStore(store);
  res.json({ success: true });
});

// Reports
app.get("/reports", authMiddleware, (_req, res) => {
  const store = loadStore();
  const totalSent = store.sentLog.length;
  const totalReplies = store.replies.filter(r => !r.fromMe).length;
  const byCampaign = {};
  store.sentLog.forEach((s) => {
    const key = s.campaignId || "manual";
    byCampaign[key] = (byCampaign[key] || 0) + 1;
  });
  res.json({ totalSent, totalReplies, byCampaign });
});

app.post("/groups/create", authMiddleware, async (req, res) => {
  const { name, numbers } = req.body || {};
  if (!name || !Array.isArray(numbers) || numbers.length === 0) {
    res.status(400).json({ error: "missing_group_data" });
    return;
  }
  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const participants = numbers.map((n) => `${String(n).replace(/\D/g, "")}@c.us`);
    const chat = await client.createGroup(name, participants);
    res.json({ id: chat?.id?._serialized || null });
  } catch (e) {
    console.error("Create group error:", e);
    res.status(500).json({ error: "create_group_failed" });
  }
});

app.post("/groups/add", authMiddleware, async (req, res) => {
  const { chatId, numbers } = req.body || {};
  if (!chatId || !Array.isArray(numbers) || numbers.length === 0) {
    res.status(400).json({ error: "missing_group_data" });
    return;
  }
  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const chat = await client.getChatById(chatId);
    await chat.addParticipants(numbers.map((n) => `${String(n).replace(/\D/g, "")}@c.us`));
    res.json({ success: true });
  } catch (e) {
    console.error("Group add error:", e);
    res.status(500).json({ error: "add_participants_failed" });
  }
});

app.post("/groups/remove", authMiddleware, async (req, res) => {
  const { chatId, numbers } = req.body || {};
  if (!chatId || !Array.isArray(numbers) || numbers.length === 0) {
    res.status(400).json({ error: "missing_group_data" });
    return;
  }
  try {
    if (!clientReady) return res.status(503).json({ error: "client_not_ready" });
    const chat = await client.getChatById(chatId);
    await chat.removeParticipants(numbers.map((n) => `${String(n).replace(/\D/g, "")}@c.us`));
    res.json({ success: true });
  } catch (e) {
    console.error("Group remove error:", e);
    res.status(500).json({ error: "remove_participants_failed" });
  }
});

// Função utilitária para jitter (delay aleatório)
function randomDelay(min = 15000, max = 45000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Função utilitária para spintax simples
function spintax(msg, vars = {}) {
  // Exemplo: "{Olá|Oi|E aí} {nome}, seu pedido {saiu|tem novidades}!"
  if (!msg) return "";
  let out = msg.replace(/\{([^}]+)\}/g, (_, opts) => {
    const arr = opts.split('|');
    return arr[Math.floor(Math.random() * arr.length)];
  });
  // Substitui variáveis do tipo {{nome}}
  Object.entries(vars).forEach(([k, v]) => {
    out = out.replace(new RegExp(`{{${k}}}`, 'g'), v);
  });
  return out;
}

// Função para verificar se está em horário comercial (8h-20h)
function horarioHumano() {
  const h = new Date().getHours();
  return h >= 8 && h < 20;
}

// Função para controle de ramp-up (limite diário por idade do número)
function podeEnviarHoje(store, maxPorDia = 1000) {
  // Ajustado para 1000 apenas como default, o ideal é ser configuravel
  const hoje = new Date().toISOString().slice(0, 10);
  const enviadosHoje = (store.sentLog || []).filter(s => {
    const data = new Date(s.timestamp).toISOString().slice(0, 10);
    return data === hoje;
  }).length;
  return enviadosHoje < maxPorDia;
}

// Create HTTP server for Express + WebSocket
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });
const connectedClients = new Set();

wss.on('connection', (ws) => {
  console.log('🔗 Nova conexão WebSocket estabelecida');
  connectedClients.add(ws);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Mensagem recebida:', message.type);

      if (message.type === 'new_message') {
        // Store message
        const store = loadStore();
        if (!store.replies) store.replies = [];
        message.data.forEach(msg => {
          store.replies.push({
            ...msg,
            id: Date.now().toString() + Math.random(),
            timestamp: message.timestamp
          });
        });
        store.replies = store.replies.slice(-500);
        saveStore(store);

        // Broadcast to all connected clients
        broadcastToClients({ type: 'message_received', data: message.data });
      }

      if (message.type === 'sync_contacts') {
        // Store contacts
        const store = loadStore();
        store.contacts = message.contacts;
        saveStore(store);
        console.log(`✅ ${message.contacts.length} contatos sincronizados`);
      }

      if (message.type === 'extension_connected') {
        console.log('✅ Extensão Chrome conectada');
        ws.send(JSON.stringify({ type: 'connection_ack', timestamp: Date.now() }));
      }
    } catch (e) {
      console.error('Erro ao processar mensagem WebSocket:', e);
    }
  });

  ws.on('close', () => {
    console.log('❌ Conexão WebSocket fechada');
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('Erro WebSocket:', error);
    connectedClients.delete(ws);
  });
});

function broadcastToClients(message) {
  connectedClients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(message));
    }
  });
}

// Start HTTP + WebSocket server
const BIND_ADDRESS = process.env.BIND_ADDRESS || '127.0.0.1';
httpServer.listen(PORT, BIND_ADDRESS, () => {
  console.log(`✅ Servidor HTTP rodando em http://${BIND_ADDRESS}:${PORT}`);
  console.log(`✅ Servidor WebSocket disponível em ws://${BIND_ADDRESS}:${PORT}`);
  console.log(`📱 Instale a extensão Chrome em: chrome://extensions\n`);
});

// WPPConnect desabilitado - extensão controla WhatsApp Web
// A extensão gerencia autenticação e sincronização via WebSocket

export default app;
