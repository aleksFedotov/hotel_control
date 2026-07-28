/** Этап 1: юнит-тесты чистых функций и слоя данных Code.gs. */
const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./loadGas');

const { ctx, sheets } = loadGas(['Code.gs']);

// Объекты из vm-песочницы имеют другие прототипы — нормализуем через JSON.
const j = (x) => JSON.parse(JSON.stringify(x));

test('fmtDate / fmtTime / fmtTimestamp', () => {
  const d = new Date(2026, 6, 5, 9, 7, 3); // 05.07.2026 09:07:03
  assert.strictEqual(ctx.fmtDate(d), '2026-07-05');
  assert.strictEqual(ctx.fmtTime(d), '09:07');
  assert.strictEqual(ctx.fmtTimestamp(d), '2026-07-05 09:07:03');
});

test('fmtDateRu', () => {
  assert.strictEqual(ctx.fmtDateRu('2026-07-28'), '28.07.2026');
});

test('parseDateRu — корректные даты', () => {
  assert.strictEqual(ctx.parseDateRu('05.08.2026'), '2026-08-05');
  assert.strictEqual(ctx.parseDateRu('5.8.2026'), '2026-08-05');
  assert.strictEqual(ctx.parseDateRu(' 29.02.2028 '), '2028-02-29'); // високосный
});

test('parseDateRu — некорректный ввод', () => {
  assert.strictEqual(ctx.parseDateRu('31.02.2026'), null); // несуществующая дата
  assert.strictEqual(ctx.parseDateRu('2026-07-28'), null);
  assert.strictEqual(ctx.parseDateRu('abc'), null);
  assert.strictEqual(ctx.parseDateRu(''), null);
  assert.strictEqual(ctx.parseDateRu('32.01.2026'), null);
});

test('sortTasksByCheckin — пустое время в конец', () => {
  const tasks = [
    { room: '301', checkin_time: '' },
    { room: '203', checkin_time: '14:00' },
    { room: '105', checkin_time: '12:00' }
  ];
  const sorted = ctx.sortTasksByCheckin(tasks);
  assert.deepStrictEqual(j(sorted.map((t) => t.room)), ['105', '203', '301']);
  // исходный массив не мутирован
  assert.strictEqual(tasks[0].room, '301');
});

test('taskToRow / rowToTask — roundtrip по TASK_COLS', () => {
  const t = {
    id: 'task_1', date: '2026-07-28', room: '203', type: 'выезд', has_checkout: 'да',
    status: 'pending', guests: 2, prep_for: 2, comment: 'кроватка',
    checkin_time: '14:00', guest_list: 'Иванов', created_at: '2026-07-27 20:00:00',
    taken_at: '', done_at: '', sent_to_maid: false, tg_msg_id: ''
  };
  const row = ctx.taskToRow(t);
  assert.strictEqual(row.length, ctx.TASK_COLS.length);
  const back = ctx.rowToTask(row);
  assert.deepStrictEqual(j(back), t);
});

test('rowToTask — типы: числа и булево', () => {
  const row = ctx.TASK_COLS.map((c) => (c === 'guests' ? '3' : c === 'sent_to_maid' ? true : 'x'));
  const t = ctx.rowToTask(row);
  assert.strictEqual(t.guests, 3);
  assert.strictEqual(t.sent_to_maid, true);
});

test('nextIdFromIds', () => {
  assert.strictEqual(ctx.nextIdFromIds('task_', []), 'task_1');
  assert.strictEqual(ctx.nextIdFromIds('task_', ['task_1', 'task_7', 'task_3']), 'task_8');
  assert.strictEqual(ctx.nextIdFromIds('tkt_', ['tkt_12']), 'tkt_13');
});

test('ticketToRow / rowToTicket — roundtrip', () => {
  const t = {
    id: 'tkt_1', date: '2026-07-28', source: 'maid', room: '203',
    category: 'сантехника', description: 'кран течёт', status: 'new',
    created_by: 'maid:123', created_at: '2026-07-28 10:00:00', resolved_at: ''
  };
  assert.deepStrictEqual(j(ctx.rowToTicket(ctx.ticketToRow(t))), t);
});

// --- Слой данных на in-memory таблице ---

test('initSheets — создаёт листы с заголовками', () => {
  assert.strictEqual(ctx.initSheets(), 'Листы проверены/созданы.');
  ['Settings', 'Rooms', 'Tasks', 'Tickets', 'Log', 'Print'].forEach((n) => {
    assert.ok(sheets[n], 'лист ' + n);
  });
  assert.deepStrictEqual(j(sheets.Tasks[0]), j(ctx.TASK_COLS));
  assert.deepStrictEqual(j(sheets.Tickets[0]), j(ctx.TICKET_COLS));
});

test('setSetting / getSetting', () => {
  ctx.setSetting('WEB_PIN', '1234');
  assert.strictEqual(ctx.getSetting('WEB_PIN'), '1234');
  ctx.setSetting('WEB_PIN', '4321'); // перезапись, не дубль
  assert.strictEqual(ctx.getSetting('WEB_PIN'), '4321');
  assert.strictEqual(ctx.getSetting('NOPE'), '');
  const keys = sheets.Settings.map((r) => r[0]).filter((k) => k === 'WEB_PIN');
  assert.strictEqual(keys.length, 1);
});

test('MAID_STATE — get/set JSON', () => {
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: null });
  ctx.setMaidState({ mode: 'await_problem', taskId: 'task_1' });
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: "await_problem", taskId: "task_1" });
  ctx.setMaidState(null);
  assert.deepStrictEqual(j(ctx.getMaidState()), { mode: null });
});

test('initRooms — добавляет без дублей', () => {
  ctx.initRooms([
    { room: '203', type: 'стандарт', floor: 2 },
    { room: '105', type: 'люкс', floor: 1 }
  ]);
  ctx.initRooms([{ room: '203', type: 'стандарт', floor: 2 }]); // повтор — не добавится
  const rooms = ctx.getRooms();
  assert.strictEqual(rooms.length, 2);
  assert.deepStrictEqual(j(rooms[0]), { room: "203", type: "стандарт", floor: 2 });
});

test('createTask — дефолты и запись в лист', () => {
  const t = ctx.createTask({ date: '2026-07-28', room: '203', type: 'выезд' });
  assert.strictEqual(t.id, 'task_1');
  assert.strictEqual(t.status, 'pending');
  assert.strictEqual(t.has_checkout, 'да');
  assert.strictEqual(t.sent_to_maid, false);
  const fromSheet = ctx.getTaskById('task_1');
  assert.strictEqual(fromSheet.room, '203');
});

test('createTask — разовая задача: has_checkout=нет', () => {
  const t = ctx.createTask({ date: '2026-07-28', room: '205', type: 'текущая' });
  assert.strictEqual(t.has_checkout, 'нет');
});

test('createTask — неизвестный тип бросает ошибку', () => {
  assert.throws(() => ctx.createTask({ date: '2026-07-28', room: '1', type: 'заезд' }));
});

test('findCheckoutTask — привязка заезда к выезду', () => {
  const found = ctx.findCheckoutTask('2026-07-28', '203');
  assert.ok(found);
  assert.strictEqual(found.id, 'task_1');
  assert.strictEqual(ctx.findCheckoutTask('2026-07-28', '999'), null);
  assert.strictEqual(ctx.findCheckoutTask('2026-07-29', '203'), null);
});

test('updateTask — заполнение полей заезда', () => {
  const t = ctx.updateTask('task_1', { checkin_time: '14:00', guests: 2, guest_list: 'Иванов' });
  assert.strictEqual(t.checkin_time, '14:00');
  assert.strictEqual(ctx.getTaskById('task_1').guest_list, 'Иванов');
});

test('updateTaskStatus — метки времени и идемпотентность', () => {
  ctx.createTask({ date: '2026-07-28', room: '301', type: 'выезд' });
  const r1 = ctx.updateTaskStatus('task_2', 'in_progress');
  assert.strictEqual(r1.changed, true);
  assert.ok(r1.task.taken_at !== '');
  const r2 = ctx.updateTaskStatus('task_2', 'in_progress'); // повтор — no-op
  assert.strictEqual(r2.changed, false);
  const r3 = ctx.updateTaskStatus('task_2', 'done');
  assert.strictEqual(r3.changed, true);
  assert.ok(r3.task.done_at !== '');
  assert.throws(() => ctx.updateTaskStatus('task_2', 'странный'));
  assert.throws(() => ctx.updateTaskStatus('task_999', 'done'));
});

test('getTasksByDate — фильтр по дате и сортировка', () => {
  ctx.createTask({ date: '2026-07-29', room: '412', type: 'влажная' });
  const tasks = ctx.getTasksByDate('2026-07-28');
  assert.strictEqual(tasks.length, 3); // 203 (14:00), 205, 301 — без времени в конец
  assert.strictEqual(tasks[0].room, '203');
  assert.deepStrictEqual(j(ctx.getTasksByDate("2026-07-29").map((t) => t.room)), ["412"]);
});

test('deleteTask', () => {
  ctx.createTask({ date: '2026-07-28', room: '999', type: 'белье' });
  assert.ok(ctx.deleteTask('task_4'));
  assert.strictEqual(ctx.getTaskById('task_4'), null);
  assert.throws(() => ctx.deleteTask('task_4'));
});

test('createTicket / updateTicketStatus', () => {
  const t = ctx.createTicket({ source: 'maid', room: '203', description: 'кран течёт', created_by: 'maid:777' });
  assert.strictEqual(t.id, 'tkt_1');
  assert.strictEqual(t.status, 'new');
  assert.strictEqual(t.category, 'прочее'); // дефолт
  const r = ctx.updateTicketStatus('tkt_1', 'done');
  assert.strictEqual(r.changed, true);
  assert.ok(r.ticket.resolved_at !== '');
  assert.strictEqual(ctx.updateTicketStatus('tkt_1', 'done').changed, false);
  assert.strictEqual(ctx.getTicketsByDate(ctx.todayStr()).length, 1);
});

test('logAction пишет в Log и не роняет операции', () => {
  assert.ok(sheets.Log.length >= 2, 'есть записи лога');
});
