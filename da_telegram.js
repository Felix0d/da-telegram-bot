process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const telegramToken = process.env.TELEGRAM_TOKEN;
const daToken = process.env.DA_TOKEN;
const dpToken = process.env.DP_TOKEN;
const dxToken = process.env.DX_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL;

const http = require('http');
const { Telegraf } = require('telegraf');

// Функция создания WebSocket с поддержкой Node и браузерной среды
function createWs(url) {
  try {
    const WsClass = require('ws');
    return new WsClass(url, { rejectUnauthorized: false });
  } catch (e) {
    return new WebSocket(url);
  }
}

// Поиск данных доната в произвольной структуре ответа Centrifugo
function extractDonation(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { return null; }
  }
  if (typeof obj !== 'object') return null;
  if (obj.amount !== undefined || obj.amount_formatted !== undefined || obj.sum !== undefined) {
    return obj;
  }
  if (obj.data) return extractDonation(obj.data);
  if (obj.result) return extractDonation(obj.result);
  return null;
}

// Веб-сервер для поддержания активности на Render
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
// 1. DONATION ALERTS (🟠) — СОВРЕМЕННЫЙ CENTRIFUGO
// ==========================================
let lastDaId = null;
let daWs = null;
let pingInterval = null;

async function connectDA() {
  if (!daToken) {
    console.log("🟠 DonationAlerts: ПРОПУЩЕН (Нет токена)");
    return;
  }

  if (pingInterval) clearInterval(pingInterval);

  try {
    console.log("🟠 DA: Получаю конфигурацию через страницу виджета...");
    const widgetUrl = `https://www.donationalerts.com/widget/alerts?token=${daToken.trim()}`;
    
    const res = await fetch(widgetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      console.error(`❌ DA Виджет вернул ошибку HTTP ${res.status}`);
      setTimeout(connectDA, 10000);
      return;
    }

    const html = await res.text();

    // Извлечение JWT токена сокета Centrifugo
    const jwtMatch = html.match(/["']socket_connection_token["']\s*:\s*["']([^"']+)["']/)
                  || html.match(/token["']?\s*:\s*["'](eyJ[^"']+)["']/)
                  || html.match(/(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/);

    if (!jwtMatch) {
      console.error("❌ DA Не удалось извлечь токен Centrifugo со страницы виджета");
      setTimeout(connectDA, 15000);
      return;
    }

    const socketToken = jwtMatch[1] || jwtMatch[0];

    // Определение User ID для формирования имени канала
    let userId = null;
    try {
      const payloadBase64 = socketToken.split('.')[1];
      const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson);
      userId = payload.sub || payload.client || payload.user_id;
    } catch (e) {}

    if (!userId) {
      const userMatch = html.match(/["']user_id["']\s*:\s*(\d+)/) 
                     || html.match(/user_id\s*=\s*(\d+)/) 
                     || html.match(/\$alerts:donation_(\d+)/);
      if (userMatch) userId = userMatch[1];
    }

    if (!userId) {
      console.error("❌ DA Не удалось определить ID пользователя");
      setTimeout(connectDA, 15000);
      return;
    }

    const wsUrl = "wss://centrifugo.donationalerts.com/connection/websocket";
    console.log(`🟠 DA: Подключаюсь к Centrifugo (ID: ${userId})...`);

    daWs = createWs(wsUrl);

    const onOpen = () => {
      console.log("🟠 DA: Сокет открыт! Отправляю токен Centrifugo...");
      daWs.send(JSON.stringify({
        params: { token: socketToken },
        id: 1
      }));

      // Пинг каждые 25 секунд для удержания соединения
      pingInterval = setInterval(() => {
        if (daWs && (daWs.readyState === 1 || daWs.readyState === WebSocket.OPEN)) {
          daWs.send(JSON.stringify({}));
        }
      }, 25000);
    };

    const onMessage = (event) => {
      const rawText = typeof event.data !== 'undefined' ? event.data.toString() : event.toString();
      if (rawText === '{}') return; // Ответ на пинг

      try {
        const msg = JSON.parse(rawText);

        // 1. Успешная авторизация в Centrifugo
        if (msg.id === 1) {
          if (msg.error) {
            console.error("❌ DA Ошибка авторизации в Centrifugo:", msg.error);
            return;
          }
          console.log(`🟠 DA: Авторизован! Подписываюсь на канал $alerts:donation_${userId}...`);
          daWs.send(JSON.stringify({
            params: { channel: `$alerts:donation_${userId}` },
            id: 2
          }));
          return;
        }

        // 2. Успешная подписка на донаты
        if (msg.id === 2) {
          if (msg.error) {
            console.error("❌ DA Ошибка подписки на канал:", msg.error);
            return;
          }
          console.log("🟠 DonationAlerts: ПОДКЛЮЧЕН И СЛУШАЕТ ДОНАТЫ!");
          return;
        }

        // 3. Обработка входящего доната
        const donation = extractDonation(msg);
        if (donation && (donation.amount || donation.amount_formatted || donation.sum)) {
          console.log("🟠 DA получено событие:", donation.id || "без ID");

          if (donation.id && donation.id === lastDaId) return;
          if (donation.id) lastDaId = donation.id;

          const name = donation.username || donation.name || donation.billing_name || "Аноним";
          const sum = donation.amount_formatted || donation.amount || donation.sum || "0";
          const cur = donation.currency || "RUB";
          const comment = donation.message || donation.comment || "";

          bot.telegram.sendMessage(channel, `🟠 [DonationAlerts]\n${name}: ${sum} ${cur}\n"${comment}"`)
            .then(() => console.log("🟠 DA: Уведомление доставлено в Telegram"))
            .catch((err) => console.error("❌ DA Ошибка отправки в TG:", err.message));
        }
      } catch (e) {
        console.error("❌ DA Ошибка обработки пакета:", e.message);
      }
    };

    const onError = (err) => {
      console.error("❌ DA Ошибка сокета:", err.message || err);
    };

    const onClose = () => {
      if (pingInterval) clearInterval(pingInterval);
      console.log("⚠️ DA Соединение закрыто. Переподключение через 7 сек...");
      setTimeout(connectDA, 7000);
    };

    if (typeof daWs.on === 'function') {
      daWs.on('open', onOpen);
      daWs.on('message', onMessage);
      daWs.on('error', onError);
      daWs.on('close', onClose);
    } else {
      daWs.onopen = onOpen;
      daWs.onmessage = onMessage;
      daWs.onerror = onError;
      daWs.onclose = onClose;
    }

  } catch (e) {
    if (pingInterval) clearInterval(pingInterval);
    console.error("❌ DA Сбой при установке соединения:", e.message);
    setTimeout(connectDA, 10000);
  }
}

connectDA();

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

// Запуск проверок DonatePay и DonateX
checkDonatePay();
checkDonateX();
setInterval(checkDonatePay, 20000);
setInterval(checkDonateX, 20000);
