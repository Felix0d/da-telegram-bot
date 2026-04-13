const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN; // Наш новый токен DonateX
const channel = process.env.TELEGRAM_CHANNEL;

// --- Мини-сервер для UptimeRobot ---
const http = require('http');
http.createServer((req, res) => {
  res.write("I am alive!");
  res.end();
}).listen(process.env.PORT || 3000); 

const { Telegraf } = require('telegraf');
const bot = new Telegraf(telegramToken);
bot.launch({dropPendingUpdates: true}, console.log("All systems GO!"));

// ==========================================
// 1. DONATION ALERTS (🟠)
// ==========================================
let daEventId = null;
const socket = require('socket.io-client')
  .connect("wss://socket.donationalerts.ru:443", { transports: ["websocket"], reconnection: true });

if (daToken) {
    socket.emit('add-user', { token: daToken, type: "minor" });
}

socket.on('donation', function(msg){
  let event = JSON.parse(msg);
  if (event.alert_type === '1' || event.alert_type === 1) {
    if (daEventId === event.id) return;
    daEventId = event.id;
    const user = event.username || 'Аноним';
    bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${user}: ${event.amount_formatted} ${event.currency}\n"${event.message}"`);
  }
});

// ==========================================
// 2. DONATE PAY (🔵)
// ==========================================
let lastDpId = null;
async function checkDonatePay() {
  if (!dpToken) return;
  try {
    const response = await fetch(`https://donatepay.ru/api/v1/transactions?access_token=${dpToken}&limit=5`);
    const data = await response.json();
    if (data.status === 'success' && data.data.length > 0) {
      if (lastDpId === null) { lastDpId = 0; return; }
      const newDons = data.data.filter(d => d.id > lastDpId).reverse();
      for (let d of newDons) {
        bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${d.what || 'Аноним'}: ${d.sum} ${d.currency}\n"${d.comment || ''}"`);
        lastDpId = d.id;
      }
    }
  } catch (e) { console.log("DP error"); }
}

// ==========================================
// 3. DONATE X (🟢)
// ==========================================
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) return;
  try {
    // В DonateX обычно используется этот эндпоинт для последних донатов
    const response = await fetch(`https://donatex.gg/api/v1/donations?token=${dxToken}&limit=5`);
    const data = await response.json();
    
    // Проверяем структуру (может отличаться, уточни в документации на скрине)
    if (data && data.donations) {
      if (lastDxId === null) { lastDxId = data.donations[0].id; return; }
      const newDons = data.donations.filter(d => d.id > lastDxId).reverse();
      for (let d of newDons) {
        bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || 'Аноним'}: ${d.amount} ${d.currency}\n"${d.comment || ''}"`);
        lastDxId = d.id;
      }
    }
  } catch (e) { console.log("DX error"); }
}

// Проверяем сайты каждые 15 секунд
setInterval(() => {
  checkDonatePay();
  checkDonateX();
}, 15000);
