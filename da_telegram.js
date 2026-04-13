const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');

// Веб-сервер для поддержания активности
http.createServer((req, res) => {
  res.write("Vampire Bot is awake!");
  res.end();
}).listen(process.env.PORT || 3000); 

const bot = new Telegraf(telegramToken);

bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("🚀 Системы запущены!"))
  .catch((err) => console.error("❌ Ошибка Telegram:", err.message));

// ==========================================
// 1. DONATION ALERTS (🟠)
// ==========================================
let daEventId = null;
if (daToken) {
    const socket = require('socket.io-client')
      .connect("wss://socket.donationalerts.ru:443", { transports: ["websocket"], reconnection: true });
    socket.emit('add-user', { token: daToken, type: "minor" });
    console.log("🟠 DonationAlerts: OK");
    socket.on('donation', function(msg){
      let event = JSON.parse(msg);
      if (event.alert_type === '1' || event.alert_type === 1) {
        if (daEventId === event.id) return;
        daEventId = event.id;
        bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${event.username}: ${event.amount_formatted} ${event.currency}\n"${event.message || ''}"`);
      }
    });
}

// ==========================================
// 2. DONATE PAY (🔵)
// ==========================================
let lastDpId = null;
async function checkDonatePay() {
  if (!dpToken) return;
  try {
    const response = await fetch(`https://donatepay.eu/api/v1/transactions?access_token=${dpToken}&limit=5`);
    const data = await response.json();
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
  } catch (e) {}
}

// ==========================================
// 3. DONATE X (🟢) - Тот самый проблемный узел
// ==========================================
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) { 
      if (lastDxId === null) console.log("🟢 DonateX: ПРОПУЩЕН (Нет токена)"); 
      return; 
  }
  
  try {
    // Используем максимально простой метод запроса
    const response = await fetch(`https://donatex.gg/api/v1/donations?token=${dxToken.trim()}&limit=5`, {
        headers: { 'Accept': 'application/json' }
    });
    
    const text = await response.text();
    
    // Если всё еще шлет HTML (текст начинается с <), значит токен неверный или не активен
    if (text.trim().startsWith('<')) {
        if (lastDxId === null) console.log("🟢 DonateX: Ошибка — Сервер не принял токен (вернул страницу)");
        return;
    }

    const data = JSON.parse(text);
    if (data && Array.isArray(data.donations)) {
      if (lastDxId === null) {
        lastDxId = data.donations.length > 0 ? data.donations[0].id : 0;
        console.log("🟢 DonateX: OK");
        return;
      }
      data.donations.filter(d => d.id > lastDxId).reverse().forEach(d => {
        bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || 'Аноним'}: ${d.amount} ${d.currency}\n"${d.comment || ''}"`);
        lastDxId = d.id;
      });
    }
  } catch (e) {
    if (lastDxId === null) console.log(`🟢 DonateX: Ошибка сети или API`);
  }
}

// Цикл
checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
