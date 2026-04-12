// Берем токены из настроек Render (Environment Variables)
const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

let eventId = null;

const { Telegraf } = require('telegraf');
const bot = new Telegraf(telegramToken);

bot.launch(
  {dropPendingUpdates: true,},
  console.log("Telegram bot started on Cloud")
);

const socket = require('socket.io-client')
  .connect("wss://socket.donationalerts.ru:443",
  { transports: ["websocket"] },
  {reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity
  });

socket.emit('add-user', { token: daToken, type: "minor" });

socket.on('connect', function(data){
  console.log('Connected to Donation Alerts');
});

socket.on('donation', function(msg){
  let event = JSON.parse(msg);
  if (event.alert_type === '1' || event.alert_type === 1) {
    if (eventId === event.id) {return}
    if (event.username === null){ event.username = 'Аноним'}
    eventId = event.id
    console.log(`${event.username} донатит ${event.amount_formatted} ${event.currency}`);
    bot.telegram.sendMessage(channel, `${event.username} донатит ${event.amount_formatted} ${event.currency} и говорит: "${event.message}"`);
  }
});