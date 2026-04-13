const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

// --- Мини-сервер для UptimeRobot (чтобы Render не засыпал) ---
const http = require('http');
http.createServer((req, res) => {
  res.write("I am alive!");
  res.end();
}).listen(process.env.PORT || 3000); 

const { Telegraf } = require('telegraf');
const bot = new Telegraf(telegramToken);

// Запуск бота с очисткой зависших обновлений (лечит ошибку 409 Conflict)
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("✅ Бот запущен! Ожидаю донаты..."))
  .catch((err) => console.error("❌ Ошибка запуска Telegram:", err.message));

// ==========================================
// 1. DONATION ALERTS (🟠)
// ==========================================
let daEventId = null;
const socket = require('socket.io-client')
  .connect("wss://socket.donationalerts.ru:443", { transports: ["websocket"], reconnection: true });

if (daToken) {
    socket.emit('add-user', { token: daToken, type: "minor" });
    console.log("🟠 Подключено к DonationAlerts");
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
    
    if (data.status === 'success') {
      // Если это первый запуск и история пуста (или есть донаты)
      if (lastDpId === null) { 
        bot.telegram.sendMessage(channel, "🔵 Связь с DonatePay установлена! Бот следит за эфиром.");
        lastDpId = data.data.length > 0 ? data.data[0].id : 0; 
        return; 
      }
      
      const newDons = data.data.filter(d => d.id > lastDpId).reverse();
      for (let d of newDons) {
        bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${d.what || 'Аноним'}: ${d.sum} ${d.currency}\n"${d.comment || ''}"`);
        lastDpId = d.id;
      }
    } else {
      console.log("❌ Ошибка DonatePay API:", data.error || "Неизвестно");
    }
  } catch (e) { console.log("❌ Ошибка сети DonatePay:", e.message); }
}

// ==========================================
// 3. DONATE X (🟢)
// ==========================================
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) return;
  try {
    const response = await fetch(`https://donatex.gg/api/v1/donations?token=${dxToken}&limit=5`);
    const data = await response.json();
    
    if (data && Array.isArray(data.donations)) {
      if (lastDxId === null) { 
        bot.telegram.sendMessage(channel, "🟢 Связь с DonateX установлена!");
        lastDxId = data.donations.length > 0 ? data.donations[0].id : 0; 
        return; 
      }
      
      const newDons = data.donations.filter(d => d.id > lastDxId).reverse();
      for (let d of newDons) {
        bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || 'Аноним'}: ${d.amount} ${d.currency}\n"${d.comment || ''}"`);
        lastDxId = d.id;
      }
    }
  } catch (e) { console.log("❌ Ошибка сети DonateX:", e.message); }
}

// Проверка каждые 20 секунд
setInterval(() => {
  checkDonatePay();
  checkDonateX();
}, 20000);
