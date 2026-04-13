const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');

http.createServer((req, res) => {
  res.write("Bot is alive!");
  res.end();
}).listen(process.env.PORT || 3000); 

const bot = new Telegraf(telegramToken);

bot.launch({ dropPendingUpdates: true })
  .then(() => console.log("🚀 Бот в сети!"))
  .catch((err) => console.error("❌ Ошибка запуска:", err.message));

// Улучшенный загрузчик (добавили User-Agent, чтобы сайты нас не банили)
async function safeFetch(url, token) {
    try {
        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}` // Попробуем передать и так
            }
        });
        const text = await response.text();
        if (!text.trim().startsWith('{')) return { error: `Server returned HTML or text (Status: ${response.status})` };
        return JSON.parse(text);
    } catch (e) { return { error: e.message }; }
}

// 1. DONATION ALERTS
let daEventId = null;
if (daToken) {
    const socket = require('socket.io-client').connect("wss://socket.donationalerts.ru:443", { transports: ["websocket"] });
    socket.emit('add-user', { token: daToken, type: "minor" });
    console.log("🟠 DonationAlerts: OK");
    socket.on('donation', (msg) => {
        let event = JSON.parse(msg);
        if (event.alert_type == 1) {
            if (daEventId === event.id) return;
            daEventId = event.id;
            bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${event.username}: ${event.amount_formatted} ${event.currency}\n"${event.message || ''}"`);
        }
    });
}

// 2. DONATE PAY
let lastDpId = null;
async function checkDonatePay() {
  if (!dpToken) return;
  const data = await safeFetch(`https://donatepay.eu/api/v1/transactions?access_token=${dpToken}&limit=5`, dpToken);
  if (data && data.status === 'success') {
    if (lastDpId === null) { lastDpId = data.data.length > 0 ? data.data[0].id : 0; console.log("🔵 DonatePay: OK"); return; }
    data.data.filter(d => d.id > lastDpId).reverse().forEach(d => {
      bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${d.what || 'Аноним'}: ${d.sum} ${d.currency}\n"${d.comment || ''}"`);
      lastDpId = d.id;
    });
  }
}

// 3. DONATE X (С глубокой проверкой)
let lastDxId = null;
async function checkDonateX() {
  if (!dxToken) { console.log("🟢 DonateX: ТОКЕН НЕ НАЙДЕН В НАСТРОЙКАХ"); return; }
  
  // Пробуем стандартный метод запроса через параметр token
  const data = await safeFetch(`https://donatex.gg/api/v1/donations?token=${dxToken}&limit=5`, dxToken);
  
  if (data && Array.isArray(data.donations)) {
    if (lastDxId === null) {
      lastDxId = data.donations.length > 0 ? data.donations[0].id : 0;
      console.log("🟢 DonateX: OK (Связь есть)");
      return;
    }
    data.donations.filter(d => d.id > lastDxId).reverse().forEach(d => {
      bot.telegram.sendMessage(channel, `🟢 [DonateX]\n${d.nickname || 'Аноним'}: ${d.amount} ${d.currency}\n"${d.comment || ''}"`);
      lastDxId = d.id;
    });
  } else if (data && data.error) {
    console.log(`🟢 DonateX: Ошибка — ${data.error}`);
  }
}

checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
