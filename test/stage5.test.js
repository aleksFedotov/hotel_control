/** Этап 5: серверные функции веб-приложения (Api.gs) — PIN, CRUD задач, отправка горничной, тикеты. */
const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./loadGas');

const j = (x) => JSON.parse(JSON.stringify(x));
const MAID = '555';
const PIN = '1234';
const DATE = '2026-07-28';

function loadApi(taskRows, settings) {
  const { ctx, sheets } = loadGas(['Code.gs', 'Telegram.gs', 'Bot.gs', 'Plan.gs', 'Api.gs'], {
    Settings: [['key', 'value'],
      ['BOT_TOKEN', 'T'], ['WEBHOOK_SECRET', 'sec'], ['WEB_PIN', PIN],
      ['MAID_CHAT_ID', MAID], ['ADMIN_CHAT_ID', '111']].concat(settings || []),
    Tasks: [undefined],
    Rooms: [['room', 'type', 'floor']]
  });
  sheets.Tasks = [j(ctx.TASK_COLS)].concat(taskRows || []);
  sheets.Tickets = [j(ctx.TICKET_COLS)];
  sheets.Log = [['ts', 'actor', 'action', 'entity', 'details']];
  const calls = [];
  ctx.UrlFetchApp = {
    fetch: (url, params) => {
      calls.push({ method: url.split('/').pop(), payload: JSON.parse(params.payload) });
      return { getContentText: () => JSON.stringify({ ok: true, result: { message_id: 900 + calls.length } }), getResponseCode: () => 200 };
    }
  };
  return { ctx, sheets, calls };
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

test('checkPin — верный и неверный PIN', () => {
  const { ctx } = loadApi();
  assert.strictEqual(ctx.checkPin(PIN), true);
  assert.strictEqual(ctx.checkPin('0000'), false);
  assert.strictEqual(ctx.checkPin(''), false);
});

test('все api-функции отвергают неверный PIN', () => {
  const { ctx } = loadApi();
  assert.throws(() => ctx.getWebData('0000', DATE), /Неверный PIN/);
  assert.throws(() => ctx.addCheckout('0000', DATE, '203'), /Неверный PIN/);
  assert.throws(() => ctx.addCheckin('0000', DATE, '203', {}), /Неверный PIN/);
  assert.throws(() => ctx.addOneOff('0000', DATE, 'текущая', '203'), /Неверный PIN/);
  assert.throws(() => ctx.editTask('0000', 'task_1', {}), /Неверный PIN/);
  assert.throws(() => ctx.deleteTaskWeb('0000', 'task_1'), /Неверный PIN/);
  assert.throws(() => ctx.sendToMaid('0000', 'task_1'), /Неверный PIN/);
  assert.throws(() => ctx.addTicketWeb('0000', '203', 'прочее', 'x'), /Неверный PIN/);
  assert.throws(() => ctx.updateTicketStatusWeb('0000', 'tkt_1', 'done'), /Неверный PIN/);
});

test('getWebData — задачи, тикеты и номера за дату', () => {
  const { ctx } = loadApi([taskRow()]);
  ctx.initRooms([{ room: '203', type: '', floor: 2 }]);
  const data = j(ctx.getWebData(PIN, DATE));
  assert.strictEqual(data.date, DATE);
  assert.strictEqual(data.tasks.length, 1);
  assert.strictEqual(data.tasks[0].room, '203');
  assert.deepStrictEqual(data.tickets, []);
  assert.strictEqual(data.rooms[0].room, '203');
});

test('addCheckout — создаёт выезд, дубликат отклоняется', () => {
  const { ctx } = loadApi();
  const t = j(ctx.addCheckout(PIN, DATE, '203'));
  assert.strictEqual(t.type, 'выезд');
  assert.strictEqual(t.has_checkout, 'да');
  assert.strictEqual(t.status, 'pending');
  assert.throws(() => ctx.addCheckout(PIN, DATE, '203'), /уже есть/);
});

test('addCheckin — без выезда создаёт «подготовку», с выездом — дополняет', () => {
  const { ctx } = loadApi([taskRow()]); // task_1: 203 выезд
  // Номер 305 без выезда → новая задача has_checkout='нет'
  const c1 = j(ctx.addCheckin(PIN, DATE, '305', { checkin_time: '15:00', guests: 2, prep_for: 2, comment: 'кроватка', guest_list: 'Петров' }));
  assert.strictEqual(c1.has_checkout, 'нет');
  assert.strictEqual(c1.type, 'выезд');
  assert.strictEqual(c1.checkin_time, '15:00');
  // Номер 203 с выездом → обновление существующей задачи, а не новая
  const c2 = j(ctx.addCheckin(PIN, DATE, '203', { checkin_time: '14:00', guests: 3 }));
  assert.strictEqual(c2.id, 'task_1');
  assert.strictEqual(c2.has_checkout, 'да');
  assert.strictEqual(c2.guests, 3);
  assert.strictEqual(j(ctx.getTasksByDate(DATE)).length, 2);
});

test('addOneOff — типы и валидация', () => {
  const { ctx } = loadApi();
  const t = j(ctx.addOneOff(PIN, DATE, 'влажная', '412'));
  assert.strictEqual(t.type, 'влажная');
  assert.strictEqual(t.has_checkout, 'нет');
  j(ctx.addOneOff(PIN, DATE, 'бельё', '203'));
  assert.throws(() => ctx.addOneOff(PIN, DATE, 'выезд', '203'), /Неизвестный тип/);
});

test('editTask — только разрешённые поля', () => {
  const { ctx } = loadApi([taskRow()]);
  const t = j(ctx.editTask(PIN, 'task_1', { room: '204', comment: 'поздний выезд', status: 'done', id: 'task_99' }));
  assert.strictEqual(t.room, '204');
  assert.strictEqual(t.comment, 'поздний выезд');
  assert.strictEqual(t.status, 'pending'); // status через editTask не меняется
  assert.strictEqual(t.id, 'task_1');
});

test('deleteTaskWeb — удаляет задачу', () => {
  const { ctx } = loadApi([taskRow()]);
  assert.strictEqual(ctx.deleteTaskWeb(PIN, 'task_1'), true);
  assert.strictEqual(ctx.getTaskById('task_1'), null);
});

test('sendToMaid — отправка, повторная идемпотентность, запрет в работе', () => {
  const { ctx, calls } = loadApi([taskRow()]);
  const r1 = j(ctx.sendToMaid(PIN, 'task_1'));
  assert.strictEqual(r1.already, false);
  const sent = calls.filter((c) => c.method === 'sendMessage').pop();
  assert.strictEqual(sent.payload.chat_id, MAID);
  assert.ok(sent.payload.text.indexOf('Новая задача — номер 203') >= 0);
  assert.ok(sent.payload.reply_markup.inline_keyboard[0][0].callback_data.indexOf('ip|task_1') === 0);
  assert.strictEqual(r1.task.sent_to_maid, true);
  assert.ok(r1.task.tg_msg_id !== '');
  const n = calls.filter((c) => c.method === 'sendMessage').length;
  const r2 = j(ctx.sendToMaid(PIN, 'task_1')); // повтор — без новой отправки
  assert.strictEqual(r2.already, true);
  assert.strictEqual(calls.filter((c) => c.method === 'sendMessage').length, n);
  ctx.updateTaskStatus('task_1', 'in_progress');
  ctx.updateTask('task_1', { sent_to_maid: false, tg_msg_id: '' });
  assert.throws(() => ctx.sendToMaid(PIN, 'task_1'), /уже в работе/);
});

test('sendToMaid — без зарегистрированной горничной бросает ошибку', () => {
  const { ctx } = loadApi([taskRow()]);
  ctx.setSetting('MAID_CHAT_ID', '');
  assert.throws(() => ctx.sendToMaid(PIN, 'task_1'), /не зарегистрирована/);
});

test('тикеты: addTicketWeb и updateTicketStatusWeb', () => {
  const { ctx } = loadApi();
  assert.throws(() => ctx.addTicketWeb(PIN, '203', 'сантехника', ''), /Опишите проблему/);
  const t = j(ctx.addTicketWeb(PIN, '203', 'сантехника', 'кран течёт'));
  assert.strictEqual(t.source, 'admin');
  assert.strictEqual(t.status, 'new');
  const r = j(ctx.updateTicketStatusWeb(PIN, t.id, 'done'));
  assert.strictEqual(r.ticket.status, 'done');
  assert.ok(r.ticket.resolved_at !== '');
});
