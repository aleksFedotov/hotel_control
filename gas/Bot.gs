/**
 * Отель-Контроль 2.0 — Bot.gs
 * Этап 3: точки входа веб-приложения и бота горничной.
 *
 * doGet  → SPA администратора (Index.html) или health-check.
 * doPost → Telegram webhook (секрет в URL: ?tg=1&secret=<WEBHOOK_SECRET>).
 */

// ============================================================================
// Точки входа
// ============================================================================

/** GET: без параметров → SPA; ?tg=1 → health-check. */
function doGet(e) {
  if (e && e.parameter && e.parameter.tg) {
    return textOutput_('Отель-Контроль 2.0: webhook жив.');
  }
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Отель-Контроль 2.0')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return textOutput_('Отель-Контроль 2.0: интерфейс администратора появится на этапе 6.');
  }
}

/** POST: Telegram Update. */
function doPost(e) {
  try {
    // Проверка секрета webhook'а.
    var secret = e && e.parameter ? e.parameter.secret : '';
    if (!secret || secret !== getSetting('WEBHOOK_SECRET')) {
      return textOutput_('forbidden');
    }
    if (!e.postData || !e.postData.contents) return textOutput_('ok');
    var update = JSON.parse(e.postData.contents);

    if (update.callback_query) {
      handleCallback(update.callback_query);
    } else if (update.message && update.message.text) {
      handleMessage(update.message);
    }
  } catch (err) {
    logAction('system', 'error', 'doPost', String(err && err.message || err));
  }
  return textOutput_('ok');
}

function textOutput_(text) {
  return ContentService.createTextOutput(text);
}

// ============================================================================
// Доступ: только горничная (MVP — один оператор)
// ============================================================================

function isMaid_(chatId) {
  var maidChat = String(getSetting('MAID_CHAT_ID'));
  return maidChat !== '' && String(chatId) === maidChat;
}

// ============================================================================
// Входящие сообщения
// ============================================================================

function handleMessage(msg) {
  var chatId = msg.chat.id;
  var text = String(msg.text).trim();

  if (text === '/start') return cmdStart_(chatId);
  if (!isMaid_(chatId)) {
    return tgSendMessage(chatId, 'Этот бот обслуживает персонал отеля. Обратитесь к администратору.');
  }
  if (text === '/help') return cmdHelp_(chatId);
  if (text === '/status') return cmdStatus_(chatId);
  if (text === '/plan') return handlePlanCommand(chatId);

  // Контекст диалога: ожидание даты (/plan) или описания проблемы.
  var state = getMaidState();
  if (state.mode === 'await_problem') return maidProblemText_(chatId, text, state);
  if (state.mode === 'await_date') return handlePlanDateText(chatId, text);

  tgSendMessage(chatId, 'Не понял команду. Доступно: /plan — план уборки, /status — задачи в работе, /help — справка.');
}

/** /start — регистрация горничной (первый chat_id, дальше не перезаписываем). */
function cmdStart_(chatId) {
  var existing = String(getSetting('MAID_CHAT_ID'));
  if (!existing) {
    setSetting('MAID_CHAT_ID', String(chatId));
    logAction('maid:' + chatId, 'maid_register', 'MAID_CHAT_ID', '');
    return tgSendMessage(chatId,
      'Вы зарегистрированы как горничная. Ждите задачи от администратора.\n' +
      'Для просмотра плана отправьте /plan');
  }
  if (existing === String(chatId)) {
    return tgSendMessage(chatId, 'Вы уже зарегистрированы. /plan — план уборки.');
  }
  return tgSendMessage(chatId, 'Бот уже привязан к другой горничной. Смена — через администратора.');
}

function cmdHelp_(chatId) {
  tgSendMessage(chatId,
    '<b>Команды:</b>\n' +
    '/plan — план уборки на день (сводка + детали)\n' +
    '/status — сколько номеров сейчас в работе\n' +
    '/help — эта справка\n\n' +
    'Под сообщением задачи есть кнопки: «В процессе уборки», «Готово», «Проблема».');
}

/** /status — задачи со статусом in_progress (сегодня). */
function cmdStatus_(chatId) {
  var inProgress = getTasksByDate(todayStr()).filter(function (t) { return t.status === 'in_progress'; });
  if (!inProgress.length) return tgSendMessage(chatId, 'Сейчас в работе ничего нет.');
  var lines = inProgress.map(function (t) { return '• Номер ' + escapeHtml(t.room) + ' (' + escapeHtml(t.type) + ')'; });
  tgSendMessage(chatId, '<b>В работе (' + inProgress.length + '):</b>\n' + lines.join('\n'));
}

// ============================================================================
// Текст задачи и детали заезда (общие для бота и уведомлений)
// ============================================================================

/** HTML-сообщение горничной о новой задаче. */
function buildTaskMessage(task) {
  var lines = ['🧹 <b>Новая задача — номер ' + escapeHtml(task.room) + '</b>'];
  lines.push('Тип: ' + escapeHtml(task.type === 'выезд'
    ? (task.has_checkout === 'да' ? 'Выезд' : 'Подготовка к заезду')
    : task.type));
  if (task.checkin_time) lines.push('Заезд: ' + escapeHtml(task.checkin_time));
  if (task.guests) lines.push('Гостей: ' + task.guests);
  if (task.prep_for) lines.push('Подготовить на: ' + task.prep_for);
  if (task.guest_list) lines.push('Список гостей: ' + escapeHtml(task.guest_list));
  if (task.comment) lines.push('Комментарий: ' + escapeHtml(task.comment));
  return lines.join('\n');
}

/** Блок деталей заезда для уведомления админу «готов к проверке». */
function buildCheckinDetails(task) {
  if (!task.checkin_time && !task.guests && !task.guest_list && !task.comment) {
    return 'Заезда на этот номер нет.';
  }
  var lines = [];
  if (task.checkin_time) lines.push('Заезд: ' + escapeHtml(task.checkin_time));
  if (task.guests) lines.push('Гостей: ' + task.guests);
  if (task.prep_for) lines.push('Подготовить на: ' + task.prep_for);
  if (task.guest_list) lines.push('Гости: ' + escapeHtml(task.guest_list));
  if (task.comment) lines.push('Комментарий: ' + escapeHtml(task.comment));
  return lines.join('\n');
}

// ============================================================================
// Callback'и inline-кнопок
// ============================================================================

function handleCallback(cb) {
  var data = String(cb.data || '');
  var chatId = cb.message ? cb.message.chat.id : (cb.from && cb.from.id);
  var messageId = cb.message ? cb.message.message_id : null;
  var parts = data.split('|');
  var action = parts[0];
  var arg = parts.slice(1).join('|');

  // Навигация /plan (реализация — Этап 4, Plan.gs).
  if (action === 'plan' || action === 'detail') {
    tgAnswerCallback(cb.id);
    return handlePlanCallback(chatId, messageId, action, arg);
  }

  if (!isMaid_(chatId)) {
    return tgAnswerCallback(cb.id, 'Кнопки доступны только горничной.');
  }

  if (action === 'ip') return cbStatus_(cb, arg, chatId, messageId, 'in_progress');
  if (action === 'done') return cbStatus_(cb, arg, chatId, messageId, 'done');
  if (action === 'pr') return cbProblem_(cb, arg, chatId);
  tgAnswerCallback(cb.id, 'Неизвестная кнопка.');
}

/** «В процессе уборки» / «Готово». */
function cbStatus_(cb, taskId, chatId, messageId, newStatus) {
  var r = updateTaskStatus(taskId, newStatus);
  var task = r.task;

  if (!r.changed) {
    tgAnswerCallback(cb.id, newStatus === 'done' ? 'Уже отмечено готовым.' : 'Задача уже в работе.');
    return;
  }

  if (newStatus === 'in_progress') {
    tgAnswerCallback(cb.id, 'Принято');
    if (messageId) tgEditKeyboard(chatId, messageId, taskKeyboard(taskId, 'in_progress'));
    notifyAdmin('🧹 Номер ' + escapeHtml(task.room) + ' убирается');
  } else {
    tgAnswerCallback(cb.id, 'Готово ✓');
    if (messageId) tgEditKeyboard(chatId, messageId, taskKeyboard(taskId, 'done'));
    notifyAdmin('✅ Номер ' + escapeHtml(task.room) + ' убран, готов к проверке.\n' + buildCheckinDetails(task));
  }
}

/** «Проблема» — переходим в контекст ожидания текста. */
function cbProblem_(cb, taskId, chatId) {
  setMaidState({ mode: 'await_problem', taskId: taskId });
  tgAnswerCallback(cb.id);
  tgSendMessage(chatId, 'Опишите проблему следующим сообщением.');
}

/** Текст проблемы от горничной → тикет. */
function maidProblemText_(chatId, text, state) {
  var task = getTaskById(state.taskId);
  var ticket = createTicket({
    source: 'maid',
    room: task ? task.room : '',
    description: text,
    created_by: 'maid:' + chatId
  });
  setMaidState({ mode: null });
  tgSendMessage(chatId, 'Проблема записана, администратор уведомлён.');
  notifyAdmin('⚠ Новая проблема' + (ticket.room ? ' в номере ' + escapeHtml(ticket.room) : '') +
    ':\n' + escapeHtml(text));
}

// Реализация /plan — Plan.gs (Этап 4).
