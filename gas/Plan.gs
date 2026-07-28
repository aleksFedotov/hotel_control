// ================== Plan.gs — команда /plan ==================

function handlePlanCommand(chatId) {
  tgSendMessage(chatId, 'За какой день показать план?', { keyboard: [[
    tgBtn('Сегодня', 'plan|today'),
    tgBtn('Завтра', 'plan|tomorrow'),
    tgBtn('Другая дата', 'plan|other')
  ]]});
}

// Вызывается из Bot.gs: detail|<date> → action='detail', arg=<date>;
// plan|today|tomorrow|other → action='plan', arg=<поддействие>.
function handlePlanCallback(chatId, messageId, action, arg) {
  if (action === 'detail') {
    sendPlanDetails_(chatId, arg);
    return;
  }
  if (arg === 'today' || arg === 'tomorrow') {
    const date = arg === 'today' ? fmtDate(new Date()) : tomorrowStr_();
    sendPlanSummary_(chatId, date);
    return;
  }
  if (arg === 'other') {
    setMaidState({ mode: 'await_date' });
    tgSendMessage(chatId, 'Введите дату в формате ДД.ММ.ГГГГ');
  }
}

function handlePlanDateText(chatId, text) {
  const date = parseDateRu(text);
  if (!date) {
    tgSendMessage(chatId, 'Не понял. Введите дату в формате ДД.ММ.ГГГГ (например, 15.03.2026).');
    return;
  }
  setMaidState(null);
  sendPlanSummary_(chatId, date);
}

function tomorrowStr_() {
  return fmtDate(new Date(Date.now() + 24 * 3600 * 1000));
}

function sendPlanSummary_(chatId, date) {
  const tasks = getTasksByDate(date);
  const text = buildPlanSummary(date, tasks);
  const hasAny = tasks && tasks.length > 0;
  const kb = hasAny ? [[tgBtn('Детали', 'detail|' + date)]] : null;
  const msgId = tgSendMessage(chatId, text, kb ? { keyboard: kb } : null);
  if (hasAny) tgRepinPlan(chatId, msgId);
}

function sendPlanDetails_(chatId, date) {
  tgSendMessage(chatId, buildPlanDetails(date, getTasksByDate(date)));
}

// ---------- чистые построители текста ----------

function buildPlanSummary(date, tasks) {
  tasks = tasks || [];
  const checkouts = tasks.filter(t => t.type === 'выезд' && t.has_checkout === 'да');
  const checkins = tasks.filter(t => t.type === 'выезд' && (t.guests || t.checkin_time || t.guest_list || t.comment));
  const current = tasks.filter(t => t.type === 'текущая');
  const wet = tasks.filter(t => t.type === 'влажная');
  const linen = tasks.filter(t => t.type === 'бельё');

  const lines = ['<b>План уборки на ' + fmtDateRu(date) + '</b>', ''];
  lines.push('Выезды: ' + (checkouts.length ? roomList_(checkouts) : 'нет'));
  if (checkins.length) {
    const totalGuests = checkins.reduce((s, t) => s + (parseInt(t.guests, 10) || 0), 0);
    lines.push('Заезды: ' + totalGuests + ' гост. — ' + roomList_(checkins));
  } else {
    lines.push('Заезды: нет');
  }
  lines.push('Текущая/пыль: ' + (current.length ? roomList_(current) : 'нет'));
  lines.push('Полы/влажная: ' + (wet.length ? roomList_(wet) : 'нет'));
  lines.push('Бельё: ' + (linen.length ? roomList_(linen) : 'нет'));
  return lines.join('\n');
}

function roomList_(tasks) {
  return tasks.map(t => {
    let s = escapeHtml(t.room);
    if (t.guests) s += ' (' + escapeHtml(String(t.guests)) + ')';
    return s;
  }).join(', ');
}

function buildPlanDetails(date, tasks) {
  tasks = tasks || [];
  const checkouts = tasks.filter(t => t.type === 'выезд');
  const lines = ['<b>Детали на ' + fmtDateRu(date) + '</b>', ''];
  checkouts.forEach(t => {
    if (t.has_checkout === 'нет') {
      lines.push('🔹 Подготовка ' + escapeHtml(t.room) + ' (без выезда)');
    } else {
      lines.push('🔹 Выезд ' + escapeHtml(t.room) + checkinSuffix_(t));
    }
    if (t.guest_list) lines.push('    Гости: ' + escapeHtml(t.guest_list));
    if (t.comment) lines.push('    Комментарий: ' + escapeHtml(t.comment));
  });
  const simple = [
    ['текущая', 'Текущая'],
    ['влажная', 'Полы/влажная'],
    ['бельё', 'Бельё']
  ];
  simple.forEach(([type, label]) => {
    const list = tasks.filter(t => t.type === type);
    if (list.length) lines.push(label + ': ' + roomList_(list));
  });
  return lines.join('\n');
}

function checkinSuffix_(t) {
  if (!t.checkin_time && !t.guests && !t.prep_for) return ' → заезда нет';
  let s = ' → заезд';
  if (t.checkin_time) s += ' ' + escapeHtml(t.checkin_time);
  if (t.guests) s += ', гостей ' + escapeHtml(String(t.guests));
  if (t.prep_for) s += ', подготовить на ' + escapeHtml(String(t.prep_for));
  return s + '.';
}
