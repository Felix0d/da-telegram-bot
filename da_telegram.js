process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Отключаем строгую блокировку SSL для DA

const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const https = require('https');
const { Telegraf } = require('telegraf');

// Надежный запрос рукопожатия в обход SSL-блокировок
function requestHandshake(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      rejectUnauthorized: false,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://www.donationalerts.com"
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Таймаут подключения к DA"));
    });
  });
}

// Создание экземпляра WebSocket с игнорированием ошибок сертификата
function createWebSocket(url) {
  try {
    const WsModule = require('ws');
    return new WsModule(url, { rejectUnauthorized: false });
  } catch (e) {
    return new WebSocket(url);
  }
}

// Веб-сервер для UptimeRobot
http.createServer((req, res) => {
  res.write("Vampire Bot is awake!");
  res.end();
}).listen(process.env.PORT || 3000);

const bot = new Telegraf(telegramToken);

bot.start((ctx) => {
  ctx.reply(`🦇 Бот на связи!\nТвой Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
});

bot.catch((err) => console.error("❌ Ошибка Telegraf:", err.message));

bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("🚀 Системы Telegram запущены!"))
  .catch((err) => console.error("❌ Ошибка Telegram:", err.message));

// ==========================================
// 1. DONATION ALERTS (🟠)
// ==========================================
let lastDaId = null;
let daWs = null;

async function connectDA() {
  if (!daToken) {
    console.log("🟠 DonationAlerts: ПРОПУЩЕН (Нет токена)");
    return;
  }

  try {
    console.log("🟠 DA: Шаг 1 — Запрос сессии (рукопожатие)...");
    const handshakeUrl = `https://socket.donationalerts.ru/socket.io/?EIO=3&transport=polling&t=${Date.now()}`;
    
    const response = await requestHandshake(handshakeUrl);

    if (response.status !== 200) {
      console.error(`❌ DA Сервер вернул статус ${response.status}:`, response.text.slice(0, 100));
      setTimeout(connectDA, 7000);
      return;
    }

    const sidMatch = response.text.match(/"sid":"([^"]+)"/);
    if (!sidMatch) {
      console.error("❌ DA Не удалось извлечь sid из ответа:", response.text.slice(0, 100));
      setTimeout(connectDA, 7000);
      return;
    }

    const sid = sidMatch[1];
    console.log(`🟠 DA: Сессия получена (${sid}). Шаг 2 — Подключаю сокет...`);

    const wsUrl = `wss://socket.donationalerts.ru/socket.io/?EIO=3&transport=websocket&sid=${sid}`;
    daWs = createWebSocket(wsUrl);

    const onOpen = () => {
      console.log("🟠 DA: Сокет открыт. Отправляю проверку связи (2probe)...");
      daWs.send("2probe");
    };

    const onMessage = (event) => {
      const msg = typeof event.data !== 'undefined' ? event.data.toString() : event.toString();

      if (msg === "3probe") {
        console.log("🟠 DA: Соединение подтверждено! Авторизую токен...");
        daWs.send("5");
        daWs.send(`42["add-user",{"token":"${daToken.trim()}","type":"minor"}]`);
        console.log("🟠 DonationAlerts: ПОДКЛЮЧЕН И ГОТОВ К РАБОТЕ!");
        return;
      }

      if (msg === "2") {
        daWs.send("3");
        return;
      }

      if (msg.startsWith("42")) {
        try {
          const payload = JSON.parse(msg.slice(2));
          if (payload[0] === "donation") {
            let d = payload[1];
            if (typeof d === "string") d = JSON.parse(d);

            console.log("🟠 DA получено событие:", d.id || "без ID");
            if (d.id && d.id === lastDaId) return;
            if (d.id) lastDaId = d.id;

            const name = d.username || d.name || "Аноним";
            const sum = d.amount_formatted || d.amount || "0";
            const cur = d.currency || "RUB";
            const comment = d.message || d.comment || "";

            bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${name}: ${sum} ${cur}\n"${comment}"`)
              .then(() => console.log("🟠 DA: Уведомление доставлено в Telegram"))
              .catch((err) => console.error("❌ DA Ошибка отправки в TG:", err.message));
          }
        } catch (e) {
          console.error("❌ DA Ошибка обработки:", e.message);
        }
      }
    };

    const onError = (err) => {
      console.error("❌ DA Ошибка сокета:", err.message || err);
    };

    const onClose = () => {
      console.log("⚠️ DA Сокет закрылся. Переподключение через 5 сек...");
      setTimeout(connectDA, 5000);
    };

    if (typeof daWs.on === 'function') {
      daWs.on('open', onOpen);
      daWs.on('message', onMessage);
      daWs.on('error', onError);
      daWs.on('close', onClose);
    } else {
      daWs.onopen = onOpen;
      daWs.onmessage = onMessage;
      daWs.onerror = onError;
      daWs.onclose = onClose;
    }

  } catch (e) {
    console.error("❌ DA Исключение при подключении:", e.message);
    setTimeout(connectDA, 7000);
  }
}

connectDA();

// ==========================================
// 2. DONATE PAY (🔵)
// ==========================================
let lastDpId = null;
async function checkDonatePay() {
  if (!dpToken) return;
  try {
    const response = await fetch(`https://donatepay.eu/api/v1/transactions?access_token=${dpToken.trim()}&limit=5`);
    const data = await response.json();
    if (data && data.status === 'success' && Array.isArray(data.data)) {
      if (lastDpId === null) {
        lastDpId = data.data.length > 0 ? data.data[0].id : 0;
        console.log("🔵 DonatePay: OK");
        return;
      }
      const newDons = data.data.filter(d => d.id > lastDpId).reverse();
      for (let d of newDons) {
        await bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${d.what || 'Аноним'}: ${d.sum} ${d.currency}\n"${d.comment || ''}"`)
          .catch((err) => console.error("❌ DP Ошибка отправки в TG:", err.message));
        lastDpId = d.id;
      }
    }
  } catch (e) {}
}

// ==========================================
// 3. DONATE X (🟢)
// ==========================================
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) return;

  try {
    const response = await fetch(`https://donatex.gg/api/v1/donations?token=${dxToken.trim()}&limit=5`, {
      headers: { 'Accept': 'application/json' }
    });

    const text = await response.text();
    if (text.trim().startsWith('<')) return;

    const data = JSON.parse(text);
    const donations = data.donations || data.data;

    if (data && Array.isArray(donations)) {
      if (lastDxId === null) {
        lastDxId = donations.length > 0 ? donations[0].id : 0;
        console.log("🟢 DonateX: OK");
        return;
      }
      const newDons = donations.filter(d => d.id > lastDxId).reverse();
      for (let d of newDons) {
        await bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || d.username || 'Аноним'}: ${d.amount || d.sum} ${d.currency}\n"${d.comment || ''}"`)
          .catch((err) => console.error("❌ DX Ошибка отправки в TG:", err.message));
        lastDxId = d.id;
      }
    }
  } catch (e) {}
}

checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
