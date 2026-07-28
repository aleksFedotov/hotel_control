/** Этап 4: команда /plan — сводка, детали, пин, ввод произвольной даты. */
const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./loadGas');

const j = (x) => JSON.parse(JSON.stringify(x));
const MAID = '555';
const ADMIN = '111';
const DATE = '2026-07-28';

function loadBot(taskRows) {
  const { ctx, sheets } = loadGas(['Code.gs', 'Telegram.gs', 'Bot.gs', 'Plan.gs'], {
    Settings: [['key', 'value'],
      ['BOT_TOKEN', 'T'], ['WEBHOOK_SECRET', 'sec'],
      ['MAID_CHAT_ID', MAID], ['ADMIN_CHAT_ID', ADMIN]],
    Tasks: [undefined]
  });
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
    id: 'task_1', date: DATE, room: '203', type: 'выезд', has_checkout: 'да',
    status: 'pending', guests: '', prep_for: '', comment: '',
    checkin_time: '', guest_list: '', created_at: '2026-07-27 20:00:00',
    taken_at: '', done_at: '', sent_to_maid: false, tg_msg_id: ''
  }, over);
  const { ctx } = loadGas(['Code.gs']);
  return j(ctx.taskToRow(t));
}

/** Сценарий A из User Flow: выезды 203 (заезд 14:00, 2 гостя, кроватка), 105 (без заезда),
 * 301 (заезд 18:00, 1 гость); текущая 205, 308; влажная 412; бельё 203, 105, 301. */
function scenarioA() {
  return [
    taskRow({ id: 'task_1', room: '203', guests: 2, prep_for: 2, comment: 'кроватка', checkin_time: '14:00', guest_list: 'Иванов' }),
    taskRow({ id: 'task_2', room: '105' }),
    taskRow({ id: 'task_3', room: '301', guests: 1, prep_for: 1, checkin_time: '18:00' }),
    taskRow({ id: 'task_4', room: '205', type: 'текущая', has_checkout: 'нет' }),
    taskRow({ id: 'task_5', room: '308', type: 'текущая', has_checkout: 'нет' }),
    taskRow({ id: 'task_6', room: '412', type: 'влажная', has_checkout: 'нет' }),
    taskRow({ id: 'task_7', room: '203', type: 'бельё', has_checkout: 'нет' }),
    taskRow({ id: 'task_8', room: '105', type: 'бельё', has_checkout: 'нет' }),
    taskRow({ id: 'task_9', room: '301', type: 'бельё', has_checkout: 'нет' })
  ];
}

test('/plan — предлагает выбор дня', () => {
  const { msg, calls } = loadBot();
  msg(MAID, '/plan');
  const p = calls[calls.length - 1].payload;
  const btns = p.reply_markup.inline_keyboard[0].map((b) => b.callback_data);
  assert.deepStrictEqual(btns, ['plan|today', 'plan|tomorrow', 'plan|other']);
});

test('plan|today — сводка по сценарию A', () => {
  const { cb, calls } = loadBot(scenarioA());
  cb(MAID, 'plan|today');
  const texts = calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text);
  const summary = texts.find((t) => t.indexOf('План уборки на') >= 0);
  assert.ok(summary);
  // Порядок — по времени заезда (14:00, 18:00, без заезда в конце)
  assert.ok(summary.indexOf('Выезды: 203 (2), 301 (1), 105') >= 0, summary);
  assert.ok(summary.indexOf('Заезды: 3 гост. — 203 (2), 301 (1)') >= 0, summary);
  assert.ok(summary.indexOf('Текущая/пыль: 205, 308') >= 0, summary);
  assert.ok(summary.indexOf('Полы/влажная: 412') >= 0, summary);
  assert.ok(summary.indexOf('Бельё: 203, 105, 301') >= 0, summary);
  // кнопка «Детали» с датой
  const p = calls.filter((c) => c.method === 'sendMessage').pop().payload;
  assert.strictEqual(p.reply_markup.inline_keyboard[0][0].callback_data, 'detail|' + DATE);
});

test('plan|today — сводка пинается в чате', () => {
  const { ctx, cb, calls } = loadBot(scenarioA());
  ctx.setSetting('PINNED_PLAN_MSG', '777'); // старый пин — должен открепиться
  ctx.setSetting('PINNED_PLAN_CHAT', MAID);
  cb(MAID, 'plan|today');
  const methods = calls.map((c) => c.method);
  assert.ok(methods.indexOf('unpinChatMessage') >= 0);
  const pinCall = calls.filter((c) => c.method === 'pinChatMessage').pop();
  assert.ok(pinCall);
  assert.strictEqual(String(pinCall.payload.message_id), ctx.getSetting('PINNED_PLAN_MSG'));
});

test('пустая дата — «нет» везде, без кнопки Детали и без пина', () => {
  const { cb, calls } = loadBot();
  cb(MAID, 'plan|today');
  const sendCalls = calls.filter((c) => c.method === 'sendMessage');
  const summary = sendCalls[sendCalls.length - 1].payload;
  assert.ok(summary.text.indexOf('Выезды: нет') >= 0);
  assert.ok(summary.text.indexOf('Заезды: нет') >= 0);
  assert.ok(!summary.reply_markup);
  assert.strictEqual(calls.filter((c) => c.method === 'pinChatMessage').length, 0);
});

test('detail| — детали по сценарию A', () => {
  const { cb, calls } = loadBot(scenarioA());
  cb(MAID, 'detail|' + DATE);
  const text = calls[calls.length - 1].payload.text;
  assert.ok(text.indexOf('🔹 Выезд 203 → заезд 14:00, гостей 2, подготовить на 2.') >= 0, text);
  assert.ok(text.indexOf('    Гости: Иванов') >= 0, text);
  assert.ok(text.indexOf('    Комментарий: кроватка') >= 0, text);
  assert.ok(text.indexOf('🔹 Выезд 105 → заезда нет') >= 0, text);
  assert.ok(text.indexOf('🔹 Выезд 301 → заезд 18:00, гостей 1, подготовить на 1.') >= 0, text);
  assert.ok(text.indexOf('Текущая: 205, 308') >= 0, text);
  assert.ok(text.indexOf('Полы/влажная: 412') >= 0, text);
  assert.ok(text.indexOf('Бельё: 203, 105, 301') >= 0, text);
});

test('detail| — заезд без выезда помечен «Подготовка (без выезда)»', () => {
  const { cb, calls } = loadBot([
    taskRow({ id: 'task_1', room: '410', has_checkout: 'нет', guests: 2, checkin_time: '15:00' })
  ]);
  cb(MAID, 'detail|' + DATE);
  const text = calls[calls.length - 1].payload.text;
  assert.ok(text.indexOf('🔹 Подготовка 410 (без выезда)') >= 0, text);
  assert.ok(text.indexOf('Выезд 410') < 0, text);
});

test('plan|other — запрос даты, неверный ввод, затем корректная дата', () => {
  const { ctx, msg, cb, calls } = loadBot(scenarioA());
  cb(MAID, 'plan|other');
  assert.ok(calls[calls.length - 1].payload.text.indexOf('ДД.ММ.ГГГГ') >= 0);
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: 'await_date' });
  msg(MAID, 'завтра'); // неверный формат
  assert.ok(calls[calls.length - 1].payload.text.indexOf('Не понял') >= 0);
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: 'await_date' }); // режим сохранён
  msg(MAID, '28.07.2026');
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: null }); // режим сброшен
  const summary = calls.filter((c) => c.method === 'sendMessage')
    .map((c) => c.payload.text).find((t) => t.indexOf('План уборки на 28.07.2026') >= 0);
  assert.ok(summary);
});

test('plan|tomorrow — сводка на завтрашнюю дату', () => {
  const { cb, calls } = loadBot();
  cb(MAID, 'plan|tomorrow');
  const summary = calls[calls.length - 1].payload.text;
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const ru = ('0' + tomorrow.getDate()).slice(-2) + '.' + ('0' + (tomorrow.getMonth() + 1)).slice(-2) + '.' + tomorrow.getFullYear();
  assert.ok(summary.indexOf('План уборки на ' + ru) >= 0, summary);
});

test('недопустимая дата 31.02.2026 отклоняется', () => {
  const { ctx, cb, msg, calls } = loadBot();
  cb(MAID, 'plan|other');
  msg(MAID, '31.02.2026');
  assert.ok(calls[calls.length - 1].payload.text.indexOf('Не понял') >= 0);
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: 'await_date' });
});
