const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN; // Добавили место для токена DonatePay
const channel = process.env.TELEGRAM_CHANNEL;

// --- Мини-сервер для UptimeRobot ---
const http = require('http');
http.createServer((req, res) => {
  res.write("I am alive!");
  res.end();
}).listen(process.env.PORT || 3000); 

const { Telegraf } = require('telegraf');
const bot = new Telegraf(telegramToken);

bot.launch({dropPendingUpdates: true}, console.log("Bot is online!"));

// ==========================================
// 1. DONATION ALERTS (Оранжевый)
// ==========================================
let daEventId = null;
const socket = require('socket.io-client')
  .connect("wss://socket.donationalerts.ru:443", 
  { transports: ["websocket"], reconnection: true });

// Если токен DA есть, подключаемся
if (daToken) {
    socket.emit('add-user', { token: daToken, type: "minor" });
}

socket.on('donation', function(msg){
  let event = JSON.parse(msg);
  if (event.alert_type === '1' || event.alert_type === 1) {
    if (daEventId === event.id) return;
    if (event.username === null) event.username = 'Аноним';
    daEventId = event.id;
    
    bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${event.username} донатит ${event.amount_formatted} ${event.currency}\n"${event.message}"`);
  }
});

// ==========================================
// 2. DONATE PAY (Синий)
// ==========================================
let lastDpId = null;

async function checkDonatePay() {
  if (!dpToken) return; // Если токена нет, не проверяем

  try {
    // Стучимся к DonatePay
    const response = await fetch(`https://donatepay.ru/api/v1/transactions?access_token=${dpToken}&limit=10`);
    const data = await response.json();

    if (data.status === 'success' && data.data.length > 0) {
      
      // Если это первый запуск, просто запоминаем ID последнего доната
      if (lastDpId === null) {
        lastDpId = data.data[0].id;
        return; 
      }

      // Ищем новые донаты (которые появились после lastDpId)
      const newDonations = [];
      for (let doc of data.data) {
        if (doc.id === lastDpId) break; 
        newDonations.push(doc);
      }

      // Отправляем в Телеграм (от старых к новым)
      for (let i = newDonations.length - 1; i >= 0; i--) {
        const event = newDonations[i];
        const username = event.what || 'Аноним';
        const amount = event.sum;
        const message = event.comment || '';

        bot.telegram.sendMessage(channel, `🔵 [DonatePay]\n${username} донатит ${amount}\n"${message}"`);
        lastDpId = event.id; // Обновляем ID
      }
    }
  } catch (error) {
    console.log("DonatePay fetch error:", error.message);
  }
}

// Запускаем проверку DonatePay каждые 10 секунд
setInterval(checkDonatePay, 10000);
