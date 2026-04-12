const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

// --- Добавляем мини-сервер для UptimeRobot ---
const http = require('http');
http.createServer((req, res) => {
  res.write("I am alive!");
  res.end();
}).listen(process.env.PORT || 3000); 
// --------------------------------------------

let eventId = null;
const { Telegraf } = require('telegraf');
const bot = new Telegraf(telegramToken);

bot.launch({dropPendingUpdates: true}, console.log("Bot is online!"));

const socket = require('socket.io-client')
  .connect("wss://socket.donationalerts.ru:443", 
  { transports: ["websocket"], reconnection: true });

socket.emit('add-user', { token: daToken, type: "minor" });

socket.on('donation', function(msg){
  let event = JSON.parse(msg);
  if (event.alert_type === '1' || event.alert_type === 1) {
    if (eventId === event.id) return;
    if (event.username === null) event.username = 'Аноним';
    eventId = event.id;
    bot.telegram.sendMessage(channel, `${event.username} донатит ${event.amount_formatted} ${event.currency}\n"${event.message}"`);
  }
});
