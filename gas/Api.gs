// ================== Api.gs — серверные функции веб-приложения ==================
// Все функции вызываются из Index.html через google.script.run.
// Первый аргумент всегда pin — токен сессии админа (Settings.WEB_PIN).

/** Проверка PIN при входе. Возвращает true/false. */
function checkPin(pin) {
  return String(pin) === String(getSetting('WEB_PIN'));
}

/** Guard: бросает ошибку при неверном PIN. Вызывать первой строкой каждой api-функции. */
function requirePin_(pin) {
  if (!checkPin(pin)) throw new Error('Неверный PIN. Обновите страницу и войдите заново.');
}

/** Данные для главного экрана: задачи и тикеты за дату + справочник номеров. */
function getWebData(pin, date) {
  requirePin_(pin);
  date = date || todayStr();
  return {
    date: date,
    today: todayStr(),
    tasks: getTasksByDate(date),
    tickets: getTicketsByDate(date),
    rooms: getRooms()
  };
}

// ---------- Задачи ----------

/** Добавить выезд: addCheckout(pin, date, room). */
function addCheckout(pin, date, room) {
  requirePin_(pin);
  if (findCheckoutTask(date, room)) throw new Error('Задача по номеру ' + room + ' на ' + fmtDateRu(date) + ' уже есть.');
  var t = createTask({ date: date, room: room, type: 'выезд' });
  logAction('admin', 'task_create', t.id, 'Выезд, номер ' + t.room);
  return t;
}

/**
 * Добавить/обновить заезд. fields: {checkin_time, guests, prep_for, guest_list, comment}.
 * Если на этот номер уже есть выезд — дополняет его; иначе создаёт «подготовку к заезду»
 * (type=выезд, has_checkout='нет').
 */
function addCheckin(pin, date, room, fields) {
  requirePin_(pin);
  fields = fields || {};
  var update = {
    checkin_time: fields.checkin_time || '',
    guests: fields.guests || '',
    prep_for: fields.prep_for || '',
    guest_list: fields.guest_list || '',
    comment: fields.comment || ''
  };
  var existing = findCheckoutTask(date, room);
  if (existing) {
    var t = updateTask(existing.id, update);
    logAction('admin', 'task_update', t.id, 'Заезд в номер ' + t.room);
    return t;
  }
  var created = createTask(Object.assign({ date: date, room: room, type: 'выезд', has_checkout: 'нет' }, update));
  logAction('admin', 'task_create', created.id, 'Заезд без выезда, номер ' + created.room);
  return created;
}

/** Разовая задача: type = 'текущая' | 'бельё' | 'влажная'. */
function addOneOff(pin, date, type, room) {
  requirePin_(pin);
  if (['текущая', 'бельё', 'влажная'].indexOf(type) === -1) throw new Error('Неизвестный тип разовой задачи: ' + type);
  var t = createTask({ date: date, room: room, type: type });
  logAction('admin', 'task_create', t.id, type + ', номер ' + t.room);
  return t;
}

/** Редактирование полей задачи (room, checkin_time, guests, prep_for, guest_list, comment). */
function editTask(pin, id, fields) {
  requirePin_(pin);
  var allowed = ['room', 'checkin_time', 'guests', 'prep_for', 'guest_list', 'comment', 'has_checkout'];
  var update = {};
  allowed.forEach(function (k) {
    if (fields && fields.hasOwnProperty(k)) update[k] = fields[k];
  });
  var t = updateTask(id, update);
  logAction('admin', 'task_update', id, 'Номер ' + t.room);
  return t;
}

function deleteTaskWeb(pin, id) {
  requirePin_(pin);
  return deleteTask(id);
}

/**
 * Отправить задачу горничной в Telegram.
 * Идемпотентность: уже отправленную (sent_to_maid) не шлём повторно — возвращаем {already:true};
 * задачу в работе/завершённую отправить нельзя.
 */
function sendToMaid(pin, taskId) {
  requirePin_(pin);
  var t = getTaskById(taskId);
  if (!t) throw new Error('Задача ' + taskId + ' не найдена.');
  if (t.status !== 'pending') throw new Error('Задача по номеру ' + t.room + ' уже в работе — повторная отправка не нужна.');
  if (t.sent_to_maid && t.tg_msg_id) return { task: t, already: true };
  var maidId = getSetting('MAID_CHAT_ID');
  if (!maidId) throw new Error('Горничная ещё не зарегистрирована в боте (команда /start).');
  var msgId = tgSendMessage(maidId, buildTaskMessage(t), { keyboard: taskKeyboard(t.id, t.status) });
  var updated = updateTask(t.id, { sent_to_maid: true, tg_msg_id: String(msgId) });
  logAction('admin', 'send_to_maid', t.id, 'Номер ' + t.room);
  return { task: updated, already: false };
}

// ---------- Тикеты ----------

function addTicketWeb(pin, room, category, description) {
  requirePin_(pin);
  if (!description) throw new Error('Опишите проблему.');
  return createTicket({ source: 'admin', room: room, category: category, description: description, created_by: 'admin' });
}

function updateTicketStatusWeb(pin, id, status) {
  requirePin_(pin);
  return updateTicketStatus(id, status);
}
