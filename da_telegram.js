const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');

// Сервер для UptimeRobot
http.createServer((req, res) => {
  res.write("Bot is running!");
  res.end();
}).listen(process.env.PORT || 3000); 

const bot = new Telegraf(telegramToken);

// Запуск с очисткой старых обновлений (лечит 409 Conflict)
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("🚀 Бот полностью готов! Ждем донаты..."))
  .catch((err) => console.error("❌ Ошибка запуска:", err.message));

// --- Вспомогательная функция для безопасного получения JSON ---
async function safeFetch(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();
        if (text.trim().startsWith('<')) return null; // Защита от HTML ошибок
        return JSON.parse(text);
    } catch (e) { return null; }
}

// ==========================================
// 1. DONATION ALERTS (🟠)
// ==========================================
let daEventId = null;
const socket = require('socket.io-client')
  .connect("wss://socket.donationalerts.ru:443", { transports: ["websocket"], reconnection: true });

if (daToken) {
    socket.emit('add-user', { token: daToken, type: "minor" });
    console.log("🟠 DonationAlerts: OK");
}

socket.on('donation', function(msg){
  let event = JSON.parse(msg);
  if (event.alert_type === '1' || event.alert_type === 1) {
    if (daEventId === null) { daEventId = event.id; return; } // Молчим при старте
    if (daEventId === event.id) return;
    daEventId = event.id;
    bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${event.username || 'Аноним'}: ${event.amount_formatted} ${event.currency}\n"${event.message || ''}"`);
  }
});

// ==========================================
// 2. DONATE PAY (🔵)
// ==========================================
let lastDpId = null;
async function checkDonatePay() {
  if (!dpToken) return;
  const data = await safeFetch(`https://donatepay.eu/api/v1/transactions?access_token=${dpToken}&limit=5`);
  
  if (data && data.status === 'success' && data.data) {
    if (lastDpId === null) {
      lastDpId = data.data.length > 0 ? data.data[0].id : 0;
      console.log("🔵 DonatePay: OK");
      return;
    }
    const newDons = data.data.filter(d => d.id > lastDpId).reverse();
    for (let d of newDons) {
      bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${d.what || 'Аноним'}: ${d.sum} ${d.currency}\n"${d.comment || ''}"`);
      lastDpId = d.id;
    }
  }
}

// ==========================================
// 3. DONATE X (🟢)
// ==========================================
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) return;
  const data = await safeFetch(`https://donatex.gg/api/v1/donations?token=${dxToken}&limit=5`);
  
  if (data && Array.isArray(data.donations)) {
    if (lastDxId === null) {
      lastDxId = data.donations.length > 0 ? data.donations[0].id : 0;
      console.log("🟢 DonateX: OK");
      return;
    }
    const newDons = data.donations.filter(d => d.id > lastDxId).reverse();
    for (let d of newDons) {
      bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || 'Аноним'}: ${d.amount} ${d.currency}\n"${d.comment || ''}"`);
      lastDxId = d.id;
    }
  }
}

// Проверка раз в 20 секунд
setInterval(() => {
  checkDonatePay();
  checkDonateX();
}, 20000);
