process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');

// Функция создания сокета с правильными браузерными заголовками
function createWs(url) {
  const headers = {
    "Origin": "https://www.donationalerts.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  try {
    const WsClass = require('ws');
    return new WsClass(url, { headers, rejectUnauthorized: false });
  } catch (e) {
    return new WebSocket(url);
  }
}

// Рекурсивный поиск объекта доната в теле сообщения
function extractDonation(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { return null; }
  }
  if (typeof obj !== 'object') return null;

  if (
    (obj.amount !== undefined || obj.amount_formatted !== undefined || obj.sum !== undefined) &&
    (obj.username !== undefined || obj.name !== undefined || obj.billing_name !== undefined || obj.message !== undefined)
  ) {
    return obj;
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const found = extractDonation(obj[key]);
      if (found) return found;
    } else if (typeof obj[key] === 'string' && (obj[key].startsWith('{') || obj[key].startsWith('['))) {
      try {
        const parsed = JSON.parse(obj[key]);
        const found = extractDonation(parsed);
        if (found) return found;
      } catch (e) {}
    }
  }
  return null;
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
/ 1. Сначала в терминале выполните команду:
// npm install donationalerts-api
// 
// 2. Затем замените вашу функцию connectDA() и весь блок с DonationAlerts на этот код:
const DonationAlerts = require('donationalerts-api');
// ==========================================
// 1. DONATION ALERTS (🟠) — VIA NPM MODULE
// ==========================================
function connectDA() {
  if (!daToken) {
    console.log("🟠 DonationAlerts: ПРОПУЩЕН (Нет токена)");
    return;
  }
  // Используем готовый модуль, который сам решает проблемы с токенами и сокетами Centrifugo
  const da = new DonationAlerts(daToken);
  da.on('connect', () => {
    console.log("🟠 DonationAlerts: ПОДКЛЮЧЕН И СЛУШАЕТ ДОНАТЫ!");
  });
  da.on('donation', (donation) => {
    console.log("🟠 DA получено событие:", donation.id || "без ID");
    
    const name = donation.username || "Аноним";
    const sum = donation.amount || "0";
    const cur = donation.currency || "RUB";
    const comment = donation.message || "";
    bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${name}: ${sum} ${cur}\n"${comment}"`)
      .then(() => console.log("🟠 DA: Уведомление доставлено в Telegram"))
      .catch((err) => console.error("❌ DA Ошибка отправки в TG:", err.message));
  });
  da.on('error', (err) => {
    console.error("❌ DA Ошибка:", err);
  });
  da.on('disconnect', () => {
    console.log("⚠️ DA Соединение закрыто. Переподключение...");
  });
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

checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
