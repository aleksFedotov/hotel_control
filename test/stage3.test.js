/** Этап 3: тесты бота горничной — doPost, callback'и, тикеты от горничной. */
const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./loadGas');

const j = (x) => JSON.parse(JSON.stringify(x));
const MAID = '555';
const ADMIN = '111';

/** Песочница с ботом: записывающая заглушка UrlFetchApp + ContentService/HtmlService. */
function loadBot(taskRows) {
  const { ctx, sheets } = loadGas(['Code.gs', 'Telegram.gs', 'Bot.gs'], {
    Settings: [['key', 'value'],
      ['BOT_TOKEN', 'T'], ['WEBHOOK_SECRET', 'sec'],
      ['MAID_CHAT_ID', MAID], ['ADMIN_CHAT_ID', ADMIN]],
    Tasks: [undefined].concat([]) // заполним ниже
  });
  // Инициализируем заголовки и, при желании, задачи.
  sheets.Tasks = [j(ctx.TASK_COLS)].concat(taskRows || []);
  sheets.Tickets = [j(ctx.TICKET_COLS)];
  sheets.Log = [['ts', 'actor', 'action', 'entity', 'details']];
  ctx.ContentService = { createTextOutput: (t) => ({ getContent: () => t }) };
  const calls = [];
  ctx.UrlFetchApp = {
    fetch: (url, params) => {
      calls.push({ method: url.split('/').pop(), payload: JSON.parse(params.payload) });
      return { getContentText: () => JSON.stringify({ ok: true, result: { message_id: 900 + calls.length } }), getResponseCode: () => 200 };
    }
  };
  // Хелперы симуляции webhook'а.
  const post = (update, secret) => ctx.doPost({
    parameter: { tg: '1', secret: secret === undefined ? 'sec' : secret },
    postData: { contents: JSON.stringify(update) }
  });
  const msg = (chatId, text) => post({ message: { chat: { id: chatId }, text } });
  const cb = (chatId, data, cbId) => post({
    callback_query: { id: cbId || 'cbq1', data, message: { chat: { id: chatId }, message_id: 42 } }
  });
  return { ctx, sheets, calls, post, msg, cb };
}

function taskRow(over) {
  const t = Object.assign({
    id: 'task_1', date: '2026-07-28', room: '203', type: 'выезд', has_checkout: 'да',
    status: 'pending', guests: 2, prep_for: 2, comment: 'кроватка',
    checkin_time: '14:00', guest_list: 'Иванов', created_at: '2026-07-27 20:00:00',
    taken_at: '', done_at: '', sent_to_maid: true, tg_msg_id: ''
  }, over);
  const { ctx } = loadGas(['Code.gs']);
  return j(ctx.taskToRow(t));
}

test('doPost — отвергает запрос без секрета', () => {
  const { post, calls } = loadBot();
  const r = post({ message: { chat: { id: MAID }, text: '/help' } }, 'неверный');
  assert.strictEqual(r.getContent(), 'forbidden');
  assert.strictEqual(calls.length, 0);
});

test('/start — регистрирует первую горничную, не перезаписывает', () => {
  const { ctx, msg, calls } = loadBot();
  ctx.setSetting('MAID_CHAT_ID', '');
  msg(999, '/start');
  assert.strictEqual(ctx.getSetting('MAID_CHAT_ID'), '999');
  msg(888, '/start'); // другой человек — не перезаписывает
  assert.strictEqual(ctx.getSetting('MAID_CHAT_ID'), '999');
  msg(999, '/start'); // повторно — «уже зарегистрированы»
  assert.ok(calls[calls.length - 1].payload.text.indexOf('уже зарегистрированы') >= 0);
});

test('чужой chat_id получает отказ', () => {
  const { msg, calls } = loadBot();
  msg(12345, '/help');
  assert.ok(calls[0].payload.text.indexOf('персонал отеля') >= 0);
});

test('callback ip| — статус, правка клавиатуры, уведомление админу', () => {
  const { ctx, cb, calls } = loadBot([taskRow()]);
  cb(MAID, 'ip|task_1');
  const methods = calls.map((c) => c.method);
  assert.deepStrictEqual(methods, ['answerCallbackQuery', 'editMessageReplyMarkup', 'sendMessage']);
  // клавиатура: остались [Готово][Проблема]
  const kb = calls[1].payload.reply_markup.inline_keyboard;
  assert.strictEqual(kb[0][0].callback_data, 'done|task_1');
  // админу
  assert.strictEqual(calls[2].payload.chat_id, ADMIN);
  assert.ok(calls[2].payload.text.indexOf('203 убирается') >= 0);
  // в таблице
  assert.strictEqual(ctx.getTaskById('task_1').status, 'in_progress');
  assert.ok(ctx.getTaskById('task_1').taken_at !== '');
});

test('callback done| — статус, кнопки убраны, админу детали заезда', () => {
  const { ctx, cb, calls } = loadBot([taskRow({ status: 'in_progress' })]);
  cb(MAID, 'done|task_1');
  const kb = calls[1].payload.reply_markup.inline_keyboard;
  assert.deepStrictEqual(j(kb), []);
  const adminText = calls[2].payload.text;
  assert.ok(adminText.indexOf('готов к проверке') >= 0);
  assert.ok(adminText.indexOf('Заезд: 14:00') >= 0);
  assert.ok(adminText.indexOf('Гостей: 2') >= 0);
  assert.ok(ctx.getTaskById('task_1').done_at !== '');
});

test('идемпотентность — повторный ip| не дублирует уведомление', () => {
  const { cb, calls } = loadBot([taskRow({ status: 'in_progress' })]);
  cb(MAID, 'ip|task_1');
  assert.strictEqual(calls.length, 1); // только ack
  assert.strictEqual(calls[0].method, 'answerCallbackQuery');
  assert.ok(calls[0].payload.text.indexOf('уже') >= 0);
});

test('done| без заезда — админу «Заезда на этот номер нет»', () => {
  const { cb, calls } = loadBot([taskRow({
    status: 'in_progress', guests: '', prep_for: '', comment: '', checkin_time: '', guest_list: ''
  })]);
  cb(MAID, 'done|task_1');
  assert.ok(calls[2].payload.text.indexOf('Заезда на этот номер нет') >= 0);
});

test('чужой человек не может жать кнопки задач', () => {
  const { ctx, cb, calls } = loadBot([taskRow()]);
  cb(12345, 'ip|task_1');
  assert.strictEqual(calls[0].payload.text, 'Кнопки доступны только горничной.');
  assert.strictEqual(ctx.getTaskById('task_1').status, 'pending');
});

test('pr| → текст → тикет + уведомление админу', () => {
  const { ctx, cb, msg, calls } = loadBot([taskRow()]);
  cb(MAID, 'pr|task_1');
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: 'await_problem', taskId: 'task_1' });
  calls.length = 0;
  msg(MAID, 'В ванной течёт кран <&>');
  // тикет создан
  const tickets = ctx.getTicketsByDate(ctx.todayStr());
  assert.strictEqual(tickets.length, 1);
  assert.strictEqual(tickets[0].room, '203');
  assert.strictEqual(tickets[0].source, 'maid');
  assert.strictEqual(tickets[0].created_by, 'maid:' + MAID);
  // состояние сброшено
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: null });
  // горничной подтверждение + админу с экранированием
  const texts = calls.map((c) => c.payload.text || '');
  assert.ok(texts.some((t) => t.indexOf('Проблема записана') >= 0));
  const adminMsg = calls.find((c) => c.payload.chat_id === ADMIN);
  assert.ok(adminMsg.payload.text.indexOf('⚠ Новая проблема в номере 203') >= 0);
  assert.ok(adminMsg.payload.text.indexOf('&lt;&amp;&gt;') >= 0); // экранировано
});

test('/status — список задач в работе', () => {
  const { msg, calls } = loadBot([
    taskRow(), taskRow({ id: 'task_2', room: '105', status: 'in_progress', checkin_time: '' })
  ]);
  msg(MAID, '/status');
  const text = calls[0].payload.text;
  assert.ok(text.indexOf('В работе (1)') >= 0);
  assert.ok(text.indexOf('105') >= 0);
});

test('/help — справка', () => {
  const { msg, calls } = loadBot();
  msg(MAID, '/help');
  assert.ok(calls[0].payload.text.indexOf('/plan') >= 0);
});

test('обычный текст без контекста — подсказка', () => {
  const { msg, calls } = loadBot();
  msg(MAID, 'привет');
  assert.ok(calls[0].payload.text.indexOf('Не понял команду') >= 0);
});

test('buildTaskMessage — формат сообщения о задаче', () => {
  const { ctx } = loadBot();
  const t = ctx.rowToTask(taskRow());
  const text = ctx.buildTaskMessage(t);
  assert.ok(text.indexOf('номер 203') >= 0);
  assert.ok(text.indexOf('Тип: Выезд') >= 0);
  assert.ok(text.indexOf('Заезд: 14:00') >= 0);
  assert.ok(text.indexOf('кроватка') >= 0);
  // заезд без выезда — «Подготовка к заезду»
  const t2 = ctx.rowToTask(taskRow({ has_checkout: 'нет' }));
  assert.ok(ctx.buildTaskMessage(t2).indexOf('Подготовка к заезду') >= 0);
});

test('doGet — health-check по ?tg=1', () => {
  const { ctx } = loadBot();
  const r = ctx.doGet({ parameter: { tg: '1' } });
  assert.ok(r.getContent().indexOf('webhook жив') >= 0);
});
