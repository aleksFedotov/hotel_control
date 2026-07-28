/** Этап 7: печатный лист — getPrintSheetData (данные) и форма в Index.html. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadGas } = require('./loadGas');

const j = (x) => JSON.parse(JSON.stringify(x));
const PIN = '1234';
const DATE = '2026-07-28';

function loadPrint(taskRows) {
  const { ctx, sheets } = loadGas(['Code.gs', 'Telegram.gs', 'Bot.gs', 'Plan.gs', 'Api.gs', 'Print.gs'], {
    Settings: [['key', 'value'], ['WEB_PIN', PIN], ['BOT_TOKEN', 'T']],
    Tasks: [undefined],
    Rooms: [['room', 'type', 'floor'], ['101', '', 1], ['203', '', 2], ['305', '', 3], ['412', '', 4]]
  });
  sheets.Tasks = [j(ctx.TASK_COLS)].concat(taskRows || []);
  sheets.Tickets = [j(ctx.TICKET_COLS)];
  sheets.Log = [['ts', 'actor', 'action', 'entity', 'details']];
  return { ctx };
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

test('getPrintSheetData — статусы свободен/убирается/готов', () => {
  const { ctx } = loadPrint([
    taskRow({ id: 'task_1', room: '203', status: 'in_progress' }),
    taskRow({ id: 'task_2', room: '412', status: 'done' })
  ]);
  const d = j(ctx.getPrintSheetData(PIN, DATE));
  assert.strictEqual(d.dateRu, '28.07.2026');
  const byRoom = {};
  d.rows.forEach((r) => { byRoom[r.room] = r; });
  assert.strictEqual(byRoom['101'].checkoutStatus, 'свободен'); // нет задачи
  assert.strictEqual(byRoom['203'].checkoutStatus, 'убирается');
  assert.strictEqual(byRoom['412'].checkoutStatus, 'готов');
  assert.strictEqual(byRoom['305'].checkoutStatus, 'свободен');
});

test('заезд без выезда — пустой статус слева, время и комментарий справа', () => {
  const { ctx } = loadPrint([
    taskRow({ id: 'task_1', room: '305', has_checkout: 'нет', checkin_time: '15:00', guests: 2, guest_list: 'Петров', comment: 'кроватка' })
  ]);
  const d = j(ctx.getPrintSheetData(PIN, DATE));
  const r = d.rows.filter((x) => x.room === '305')[0];
  assert.strictEqual(r.checkoutStatus, '');
  assert.strictEqual(r.checkinTime, '15:00');
  assert.strictEqual(r.checkinComment, 'гостей: 2; Петров; кроватка');
});

test('выезд с заездом — статус слева, заезд справа', () => {
  const { ctx } = loadPrint([
    taskRow({ id: 'task_1', room: '203', checkin_time: '14:00', guests: 3, prep_for: 2 })
  ]);
  const d = j(ctx.getPrintSheetData(PIN, DATE));
  const r = d.rows.filter((x) => x.room === '203')[0];
  assert.strictEqual(r.checkoutStatus, 'убирается');
  assert.strictEqual(r.checkinTime, '14:00');
  assert.strictEqual(r.checkinComment, 'гостей: 3; на 2');
});

test('нижние строки: текущая / влажная / бельё', () => {
  const { ctx } = loadPrint([
    taskRow({ id: 'task_1', room: '101', type: 'текущая', has_checkout: 'нет' }),
    taskRow({ id: 'task_2', room: '203', type: 'текущая', has_checkout: 'нет' }),
    taskRow({ id: 'task_3', room: '412', type: 'влажная', has_checkout: 'нет' }),
    taskRow({ id: 'task_4', room: '305', type: 'бельё', has_checkout: 'нет' })
  ]);
  const d = j(ctx.getPrintSheetData(PIN, DATE));
  assert.strictEqual(d.bottom.current, '101, 203');
  assert.strictEqual(d.bottom.wet, '412');
  assert.strictEqual(d.bottom.linen, '305');
});

test('getPrintSheetData — требует PIN', () => {
  const { ctx } = loadPrint();
  assert.throws(() => ctx.getPrintSheetData('0000', DATE), /Неверный PIN/);
});

test('Index.html — вкладка печати вызывает getPrintSheetData и window.print', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Index.html'), 'utf8');
  assert.ok(html.indexOf("api('getPrintSheetData'") >= 0);
  assert.ok(html.indexOf('window.print()') >= 0);
  assert.ok(html.indexOf('A4 landscape') >= 0);
  assert.ok(html.indexOf('Время прибытия') >= 0);
  assert.ok(html.indexOf('Текущая/пыль') >= 0);
});
