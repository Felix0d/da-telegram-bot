const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');

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
// 1. DONATION ALERTS (🟠) - ОБНОВЛЕННЫЙ СОКЕТ
// ==========================================
let lastDaId = null;

if (daToken) {
  const io = require('socket.io-client');
  
  // Добавляем браузерную маскировку и поддержку polling для обхода фильтров Cloudflare
  const socket = io("https://socket.donationalerts.ru:443", { 
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionDelay: 5000,
    forceNew: true,
    extraHeaders: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Origin": "https://www.donationalerts.com"
    }
  });

  socket.on('connect', () => {
    console.log("🟠 DA: Соединение установлено! Отправляю токен авторизации...");
    socket.emit('add-user', { token: daToken.trim(), type: "minor" });
  });

  socket.on('connect_error', (err) => {
    console.error("❌ DA Ошибка подключения сокета:", err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log("⚠️ DA Сокет отключился:", reason);
  });

  socket.on('donation', function(msg) {
    try {
      let event = typeof msg === 'string' ? JSON.parse(msg) : msg;
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

    } catch (e) {
      console.error("❌ DA Ошибка обработки:", e.message);
    }
  });
} else {
  console.log("🟠 DonationAlerts: ПРОПУЩЕН (Нет токена)");
}

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

// Интервалы
checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
