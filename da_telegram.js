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

bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("🚀 Системы запущены! Ожидаю..."))
  .catch((err) => console.error("❌ Ошибка Telegram:", err.message));

async function safeFetch(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return { error: `HTTP ${response.status}` };
        const text = await response.text();
        if (text.trim().startsWith('<')) return { error: "HTML_PAGE" };
        return JSON.parse(text);
    } catch (e) { return { error: e.message }; }
}

// 1. DONATION ALERTS (🟠)
let daEventId = null;
if (daToken) {
    const socket = require('socket.io-client')
      .connect("wss://socket.donationalerts.ru:443", { transports: ["websocket"], reconnection: true });
    socket.emit('add-user', { token: daToken, type: "minor" });
    console.log("🟠 DonationAlerts: OK");

    socket.on('donation', function(msg){
      let event = JSON.parse(msg);
      if (event.alert_type === '1' || event.alert_type === 1) {
        if (daEventId === null) { daEventId = event.id; return; }
        if (daEventId === event.id) return;
        daEventId = event.id;
        bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${event.username}: ${event.amount_formatted} ${event.currency}\n"${event.message || ''}"`);
      }
    });
}

// 2. DONATE PAY (🔵)
let lastDpId = null;
async function checkDonatePay() {
  if (!dpToken) { if (lastDpId === null) console.log("🔵 DonatePay: ПРОПУЩЕН"); return; }
  const data = await safeFetch(`https://donatepay.eu/api/v1/transactions?access_token=${dpToken}&limit=5`);
  if (data && data.status === 'success') {
    if (lastDpId === null) {
      lastDpId = data.data.length > 0 ? data.data[0].id : 0;
      console.log("🔵 DonatePay: OK");
      return;
    }
    data.data.filter(d => d.id > lastDpId).reverse().forEach(d => {
      bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${d.what || 'Аноним'}: ${d.sum} ${d.currency}\n"${d.comment || ''}"`);
      lastDpId = d.id;
    });
  }
}

// 3. DONATE X (🟢)
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) { 
      if (lastDxId === null) console.log("🟢 DonateX: ПРОПУЩЕН (Проверь DX_TOKEN)"); 
      lastDxId = -1; return; 
  }
  const data = await safeFetch(`https://donatex.gg/api/v1/donations?token=${dxToken}&limit=5`);
  if (data && Array.isArray(data.donations)) {
    if (lastDxId === null || lastDxId === -1) {
      lastDxId = data.donations.length > 0 ? data.donations[0].id : 0;
      console.log("🟢 DonateX: OK");
      return;
    }
    data.donations.filter(d => d.id > lastDxId).reverse().forEach(d => {
      bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || 'Аноним'}: ${d.amount} ${d.currency}\n"${d.comment || ''}"`);
      lastDxId = d.id;
    });
  }
}

// --- ЗАПУСК ПРОВЕРОК ---
// Проверяем сразу при старте
checkDonatePay();
checkDonateX();

// И запускаем интервалы
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
