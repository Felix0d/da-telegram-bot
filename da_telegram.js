const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');
const WebSocket = globalThis.WebSocket || require('ws');

// Сервер для UptimeRobot
http.createServer((req, res) => {
  res.write("Vampire Bot is awake!");
  res.end();
}).listen(process.env.PORT || 3000);

const bot = new Telegraf(telegramToken);

bot.start((ctx) => {
  ctx.reply(`🦇 Бот на связи!\nТвой Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
});

bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("🚀 Системы Telegram запущены!"))
  .catch((err) => console.error("❌ Ошибка Telegram:", err.message));

// ==========================================
// 1. DONATION ALERTS (🟠) — НАПРЯМУЮ ЧЕРЕЗ EIO=3
// ==========================================
let lastDaId = null;
let daWs = null;

function connectDA() {
  if (!daToken) {
    console.log("🟠 DonationAlerts: ПРОПУЩЕН (Нет токена)");
    return;
  }

  console.log("🟠 DA: Подключение к сокету (EIO=3)...");
  
  try {
    daWs = new WebSocket("wss://socket.donationalerts.ru/socket.io/?EIO=3&transport=websocket");
  } catch (e) {
    console.error("❌ DA Ошибка запуска сокета:", e.message);
    setTimeout(connectDA, 5000);
    return;
  }

  const handleOpen = () => {
    console.log("🟠 DA: Канал WebSocket открыт, жду рукопожатия сервера...");
  };

  const handleMessage = (raw) => {
    const msg = typeof raw.data !== 'undefined' ? raw.data.toString() : raw.toString();

    // 0 — Пакет рукопожатия от сервера Engine.IO
    if (msg.startsWith('0')) {
      console.log("🟠 DA: Рукопожатие подтверждено! Авторизую токен...");
      const authPayload = `42["add-user",{"token":"${daToken.trim()}","type":"minor"}]`;
      daWs.send(authPayload);
      console.log("🟠 DonationAlerts: ПОДКЛЮЧЕН И АВТОРИЗОВАН!");
      return;
    }

    // 2 — Пинг от сервера, отправляем 3 (понг)
    if (msg === '2') {
      daWs.send('3');
      return;
    }

    // 42 — Сообщение с событием (донат)
    if (msg.startsWith('42')) {
      try {
        const payload = JSON.parse(msg.slice(2));
        if (payload[0] === 'donation') {
          let event = payload[1];
          if (typeof event === 'string') event = JSON.parse(event);

          console.log("🟠 DA получено событие:", event.id || 'без ID');

          if (event.id && event.id === lastDaId) return;
          if (event.id) lastDaId = event.id;

          const name = event.username || event.name || 'Аноним';
          const sum = event.amount_formatted || event.amount || '0';
          const cur = event.currency || 'RUB';
          const comment = event.message || event.comment || '';

          bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${name}: ${sum} ${cur}\n"${comment}"`)
            .then(() => console.log("🟠 DA: Уведомление доставлено в Telegram"))
            .catch((err) => console.error("❌ DA Ошибка отправки в TG:", err.message));
        }
      } catch (e) {
        console.error("❌ DA Ошибка парсинга сообщения:", e.message);
      }
    }
  };

  const handleError = (err) => {
    console.error("❌ DA Ошибка соединения:", err.message || err);
  };

  const handleClose = () => {
    console.log("⚠️ DA Сокет закрылся. Переподключение через 5 сек...");
    setTimeout(connectDA, 5000);
  };

  if (typeof daWs.on === 'function') {
    daWs.on('open', handleOpen);
    daWs.on('message', handleMessage);
    daWs.on('error', handleError);
    daWs.on('close', handleClose);
  } else {
    daWs.onopen = handleOpen;
    daWs.onmessage = handleMessage;
    daWs.onerror = handleError;
    daWs.onclose = handleClose;
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

// Интервалы проверок
checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
