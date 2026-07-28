/**
 * Отель-Контроль 2.0 — Telegram.gs
 * Этап 2: транспорт к Telegram Bot API.
 *
 * Все сообщения — в parse_mode 'HTML' (единый режим во всём проекте).
 * Любой динамический текст перед вставкой пропускать через escapeHtml().
 */

var TG_API = 'https://api.telegram.org/bot';
var TG_MAX_LEN = 4096;

// ============================================================================
// Текст: экранирование и разбивка длинных сообщений (чистые функции)
// ============================================================================

/** Экранирование спецсимволов HTML для parse_mode='HTML'. */
function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Разбивает длинный текст на части ≤ лимита Telegram.
 * Режет по переносам строк (не разрывая абзац), крайний случай — жёстко по лимиту.
 */
function splitMessage(text, limit) {
  limit = limit || TG_MAX_LEN;
  text = String(text);
  if (text.length <= limit) return [text];
  var parts = [];
  var current = '';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // Одна строка длиннее лимита — режем жёстко.
    while (line.length > limit) {
      if (current) { parts.push(current); current = ''; }
      parts.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    var candidate = current ? current + '\n' + line : line;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      parts.push(current);
      current = line;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// ============================================================================
// Базовый вызов Bot API
// ============================================================================

/**
 * Вызов метода Bot API. payload — объект параметров (сериализуется в JSON).
 * Возвращает распарсенный result ответа или бросает ошибку.
 */
function tgApi(method, payload) {
  var token = getSetting('BOT_TOKEN');
  if (!token) throw new Error('BOT_TOKEN не задан в Settings.');
  var resp = UrlFetchApp.fetch(TG_API + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  var data = JSON.parse(resp.getContentText());
  if (!data.ok) {
    throw new Error('Telegram API ' + method + ': ' + (data.description || 'ошибка ' + resp.getResponseCode()));
  }
  return data.result;
}

// ============================================================================
// Отправка сообщений
// ============================================================================

/**
 * Отправка сообщения. opts: {keyboard: [[{text, callback_data}...]...], html: true}
 * Длинный текст автоматически режется на несколько сообщений (клавиатура — на последнем).
 * Возвращает message_id последнего сообщения.
 */
function tgSendMessage(chatId, text, opts) {
  opts = opts || {};
  var parts = splitMessage(text);
  var lastId = null;
  for (var i = 0; i < parts.length; i++) {
    var payload = {
      chat_id: chatId,
      text: parts[i],
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (opts.keyboard && i === parts.length - 1) {
      payload.reply_markup = { inline_keyboard: opts.keyboard };
    }
    var result = tgApi('sendMessage', payload);
    lastId = result.message_id;
  }
  return lastId;
}

// ============================================================================
// Callback'и и клавиатуры
// ============================================================================

/** Короткий popup-ответ на нажатие inline-кнопки. */
function tgAnswerCallback(callbackQueryId, text) {
  tgApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

/** Заменить inline-клавиатуру сообщения (keyboard=null — убрать кнопки). */
function tgEditKeyboard(chatId, messageId, keyboard) {
  tgApi('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard || [] }
  });
}

/** Построить ряд кнопок: tgBtn('Готово', 'done|task_1') */
function tgBtn(text, callbackData) {
  return { text: text, callback_data: callbackData };
}

/** Клавиатура задачи в зависимости от статуса. */
function taskKeyboard(taskId, status) {
  if (status === 'done') return [];
  if (status === 'in_progress') {
    return [[tgBtn('Готово', 'done|' + taskId), tgBtn('Проблема', 'pr|' + taskId)]];
  }
  return [[tgBtn('В процессе уборки', 'ip|' + taskId)],
          [tgBtn('Готово', 'done|' + taskId), tgBtn('Проблема', 'pr|' + taskId)]];
}

// ============================================================================
// Пин сообщений (для /plan)
// ============================================================================

function tgPin(chatId, messageId) {
  tgApi('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true });
}

function tgUnpin(chatId, messageId) {
  try {
    tgApi('unpinChatMessage', { chat_id: chatId, message_id: messageId });
  } catch (e) {
    // Сообщение могло быть удалено/отпинено вручную — не критично.
  }
}

/** Перепинить план: отпинить предыдущий (если был), запинить новый, сохранить в Settings. */
function tgRepinPlan(chatId, messageId) {
  var oldMsg = getSetting('PINNED_PLAN_MSG');
  var oldChat = getSetting('PINNED_PLAN_CHAT');
  if (oldMsg && oldChat) tgUnpin(oldChat, oldMsg);
  tgPin(chatId, messageId);
  setSetting('PINNED_PLAN_MSG', String(messageId));
  setSetting('PINNED_PLAN_CHAT', String(chatId));
}

// ============================================================================
// Webhook
// ============================================================================

/** Одноразовая установка webhook. Запускать из редактора GAS после деплоя. */
function setupWebhook() {
  var url = getSetting('WEB_APP_URL') + '?tg=1&secret=' + getSetting('WEBHOOK_SECRET');
  var result = tgApi('setWebhook', { url: url });
  return 'Webhook установлен: ' + url + ' → ' + JSON.stringify(result);
}

/** Проверка webhook: вернуть getWebhookInfo. */
function webhookInfo() {
  return JSON.stringify(tgApi('getWebhookInfo', {}), null, 2);
}

// ============================================================================
// Уведомления участникам (вспомогательные, используются на этапах 3–5)
// ============================================================================

/** Сообщение администратору в личный чат. Молчит, если ADMIN_CHAT_ID не задан. */
function notifyAdmin(text) {
  var adminChat = getSetting('ADMIN_CHAT_ID');
  if (!adminChat) return null;
  return tgSendMessage(adminChat, text);
}

/** Сообщение горничной. Молчит, если MAID_CHAT_ID не задан. */
function notifyMaid(text, opts) {
  var maidChat = getSetting('MAID_CHAT_ID');
  if (!maidChat) return null;
  return tgSendMessage(maidChat, text, opts);
}
