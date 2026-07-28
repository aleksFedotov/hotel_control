/**
 * Отель-Контроль 2.0 — Code.gs
 * Этап 1: каркас, листы, Settings, Rooms, слой данных Tasks/Tickets, Log.
 *
 * Соглашения:
 *  - Даты хранятся строкой 'yyyy-MM-dd', время — 'HH:mm'.
 *  - Каждая строка Tasks = одна задача. Заезд — атрибуты выезда (has_checkout='да'
 *    означает реальный выезд гостей; 'нет' — только подготовка номера к заезду).
 */

// ============================================================================
// Константы: листы и заголовки
// ============================================================================

var SHEET = {
  SETTINGS: 'Settings',
  ROOMS: 'Rooms',
  TASKS: 'Tasks',
  TICKETS: 'Tickets',
  PRINT: 'Print',
  LOG: 'Log'
};

/** Порядок колонок листа Tasks. Не менять без миграции таблицы. */
var TASK_COLS = [
  'id',            // task_<n>
  'date',          // yyyy-MM-dd
  'room',          // '203'
  'type',          // выезд | текущая | белье | влажная
  'has_checkout',  // да | нет (реальный выезд гостей или только заезд)
  'status',        // pending | in_progress | done
  'guests',        // число или ''
  'prep_for',      // число или ''
  'comment',       // заметка администратора
  'checkin_time',  // 'HH:mm' или ''
  'guest_list',    // 'Иванов И.И., Петров П.П.' или ''
  'created_at',    // 'yyyy-MM-dd HH:mm:ss'
  'taken_at',      // или ''
  'done_at',       // или ''
  'sent_to_maid',  // true | false
  'tg_msg_id'      // message_id сообщения бота или ''
];

/** Порядок колонок листа Tickets. */
var TICKET_COLS = [
  'id', 'date', 'source', 'room', 'category', 'description',
  'status', 'created_by', 'created_at', 'resolved_at'
];

var ROOM_COLS = ['room', 'type', 'floor'];
var LOG_COLS = ['ts', 'actor', 'action', 'entity', 'details'];

var TASK_TYPES = ['выезд', 'текущая', 'белье', 'влажная'];
var TASK_STATUSES = ['pending', 'in_progress', 'done'];
var TICKET_CATEGORIES = ['сантехника', 'электрика', 'мебель', 'расходники', 'прочее'];
var TICKET_STATUSES = ['new', 'in_progress', 'done'];

/** Стартовый справочник номеров. Тип не указан владельцем — оставлен пустым, этаж выведен из номера. */
var ROOMS_SEED = [
  { room: '101', type: '', floor: 1 },
  { room: '102', type: '', floor: 1 },
  { room: '103', type: '', floor: 1 },
  { room: '104', type: '', floor: 1 },
  { room: '105', type: '', floor: 1 },
  { room: '201', type: '', floor: 2 },
  { room: '202', type: '', floor: 2 },
  { room: '203', type: '', floor: 2 },
  { room: '204', type: '', floor: 2 },
  { room: '205', type: '', floor: 2 },
  { room: '206', type: '', floor: 2 },
  { room: '207', type: '', floor: 2 },
  { room: '208', type: '', floor: 2 },
  { room: '209', type: '', floor: 2 },
  { room: '210', type: '', floor: 2 },
  { room: '211', type: '', floor: 2 },
  { room: '212', type: '', floor: 2 },
  { room: '213', type: '', floor: 2 },
];

// ============================================================================
// Утилиты дат и времени (чистые функции — покрыты тестами)
// ============================================================================

/** Дата -> 'yyyy-MM-dd'. */
function fmtDate(d) {
  var y = d.getFullYear();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

/** Дата -> 'HH:mm'. */
function fmtTime(d) {
  var h = ('0' + d.getHours()).slice(-2);
  var m = ('0' + d.getMinutes()).slice(-2);
  return h + ':' + m;
}

/** Дата -> 'yyyy-MM-dd HH:mm:ss'. */
function fmtTimestamp(d) {
  var s = ('0' + d.getSeconds()).slice(-2);
  return fmtDate(d) + ' ' + fmtTime(d) + ':' + s;
}

/** 'yyyy-MM-dd' -> 'dd.MM.yyyy' (для отображения в боте). */
function fmtDateRu(isoDate) {
  var p = isoDate.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

/** 'dd.MM.yyyy' -> 'yyyy-MM-dd'; некорректный ввод -> null. */
function parseDateRu(text) {
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  var d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return fmtDate(dt);
}

/** Текущая дата строкой 'yyyy-MM-dd'. */
function todayStr() {
  return fmtDate(new Date());
}

/** Текущий штамп 'yyyy-MM-dd HH:mm:ss'. */
function nowStr() {
  return fmtTimestamp(new Date());
}

/**
 * Сортировка задач для «Списка на уборку» и печати:
 * по checkin_time ASC; пустое время трактуется как '23:59' (в конец).
 */
function sortTasksByCheckin(tasks) {
  return tasks.slice().sort(function (a, b) {
    var ta = a.checkin_time || '23:59';
    var tb = b.checkin_time || '23:59';
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });
}

// ============================================================================
// Маппинг объект <-> строка листа (чистые функции — покрыты тестами)
// ============================================================================

/** Объект задачи -> массив значений строки Tasks по TASK_COLS. */
function taskToRow(t) {
  return TASK_COLS.map(function (c) {
    var v = t[c];
    if (v === undefined || v === null) v = (c === 'sent_to_maid' ? false : '');
    return v;
  });
}

/** Строка листа Tasks -> объект задачи. */
function rowToTask(row) {
  var t = {};
  TASK_COLS.forEach(function (c, i) { t[c] = row[i]; });
  t.guests = (t.guests === '' || t.guests === undefined) ? '' : Number(t.guests);
  t.prep_for = (t.prep_for === '' || t.prep_for === undefined) ? '' : Number(t.prep_for);
  t.sent_to_maid = (t.sent_to_maid === true || t.sent_to_maid === 'true');
  return t;
}

/** Объект тикета -> массив значений строки Tickets. */
function ticketToRow(t) {
  return TICKET_COLS.map(function (c) {
    var v = t[c];
    return (v === undefined || v === null) ? '' : v;
  });
}

/** Строка листа Tickets -> объект тикета. */
function rowToTicket(row) {
  var t = {};
  TICKET_COLS.forEach(function (c, i) { t[c] = row[i]; });
  return t;
}

/** Генерация следующего id по префиксу: max числового суффикса + 1. */
function nextIdFromIds(prefix, ids) {
  var max = 0;
  ids.forEach(function (id) {
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(String(id));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + (max + 1);
}

// ============================================================================
// Доступ к таблице
// ============================================================================

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Лист «' + name + '» не найден. Создайте его по чек-листу развёртывания.');
  return sh;
}

/** Создаёт недостающие листы и проставляет заголовки. Запускать один раз. */
function initSheets() {
  var book = ss_();
  var defs = [
    [SHEET.SETTINGS, ['key', 'value']],
    [SHEET.ROOMS, ROOM_COLS],
    [SHEET.TASKS, TASK_COLS],
    [SHEET.TICKETS, TICKET_COLS],
    [SHEET.LOG, LOG_COLS]
  ];
  defs.forEach(function (d) {
    var sh = book.getSheetByName(d[0]);
    if (!sh) sh = book.insertSheet(d[0]);
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, d[1].length).setValues([d[1]]);
  });
  if (!book.getSheetByName(SHEET.PRINT)) book.insertSheet(SHEET.PRINT);
  return 'Листы проверены/созданы.';
}

// ============================================================================
// Settings (ключ-значение)
// ============================================================================

function getSetting(key) {
  var sh = sheet_(SHEET.SETTINGS);
  var last = sh.getLastRow();
  if (last < 2) return '';
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === key) return values[i][1];
  }
  return '';
}

function setSetting(key, value) {
  var sh = sheet_(SHEET.SETTINGS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var values = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][0] === key) {
        sh.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sh.appendRow([key, value]);
}

/** MAID_STATE: {mode: 'await_date'|'await_problem'|null, taskId: ...} */
function getMaidState() {
  var raw = getSetting('MAID_STATE');
  if (!raw) return { mode: null };
  try { return JSON.parse(raw); } catch (e) { return { mode: null }; }
}

function setMaidState(state) {
  setSetting('MAID_STATE', JSON.stringify(state || { mode: null }));
}

// ============================================================================
// Rooms
// ============================================================================

/** Читает справочник номеров: [{room, type, floor}, ...]. */
function getRooms() {
  var sh = sheet_(SHEET.ROOMS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues()
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) { return { room: String(r[0]), type: r[1], floor: r[2] }; });
}

/**
 * Одноразовое наполнение Rooms из ROOMS_SEED (или из аргумента-массива).
 * Существующие номера не дублируются.
 */
function initRooms(rooms) {
  var list = rooms || ROOMS_SEED;
  if (!list.length) return 'ROOMS_SEED пуст — заполните список номеров в Code.gs.';
  var existing = {};
  getRooms().forEach(function (r) { existing[r.room] = true; });
  var sh = sheet_(SHEET.ROOMS);
  var added = 0;
  list.forEach(function (r) {
    var room = String(r.room);
    if (!existing[room]) {
      sh.appendRow([room, r.type || '', r.floor || '']);
      added++;
    }
  });
  return 'Добавлено номеров: ' + added;
}

// ============================================================================
// Tasks — слой данных
// ============================================================================

function readAllTasks_() {
  var sh = sheet_(SHEET.TASKS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, TASK_COLS.length).getValues();
  var out = [];
  rows.forEach(function (row, i) {
    if (String(row[0]).trim() === '') return;
    var t = rowToTask(row);
    t._row = i + 2; // служебное: номер строки в листе
    out.push(t);
  });
  return out;
}

/** Все задачи на дату ('yyyy-MM-dd'), отсортированные по checkin_time. */
function getTasksByDate(date) {
  return sortTasksByCheckin(readAllTasks_().filter(function (t) { return t.date === date; }));
}

function getTaskById(id) {
  var all = readAllTasks_();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function nextTaskId_() {
  return nextIdFromIds('task_', readAllTasks_().map(function (t) { return t.id; }));
}

/**
 * Создаёт задачу. data: {date, room, type, has_checkout, guests, prep_for,
 * comment, checkin_time, guest_list}. Возвращает созданную задачу.
 */
function createTask(data) {
  if (TASK_TYPES.indexOf(data.type) === -1) throw new Error('Неизвестный тип задачи: ' + data.type);
  var t = {
    id: nextTaskId_(),
    date: data.date,
    room: String(data.room),
    type: data.type,
    has_checkout: data.has_checkout || (data.type === 'выезд' ? 'да' : 'нет'),
    status: 'pending',
    guests: data.guests || '',
    prep_for: data.prep_for || '',
    comment: data.comment || '',
    checkin_time: data.checkin_time || '',
    guest_list: data.guest_list || '',
    created_at: nowStr(),
    taken_at: '',
    done_at: '',
    sent_to_maid: false,
    tg_msg_id: ''
  };
  sheet_(SHEET.TASKS).appendRow(taskToRow(t));
  logAction('admin', 'task_create', t.id, 'Номер ' + t.room + ', ' + t.type + ', ' + t.date);
  return t;
}

/**
 * Ищет задачу выезда по номеру и дате (для привязки заезда).
 * Возвращает задачу или null.
 */
function findCheckoutTask(date, room) {
  var all = readAllTasks_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].date === date && all[i].room === String(room) && all[i].type === 'выезд') return all[i];
  }
  return null;
}

/** Обновляет произвольные поля задачи. Возвращает обновлённую задачу. */
function updateTask(id, fields) {
  var t = getTaskById(id);
  if (!t) throw new Error('Задача ' + id + ' не найдена.');
  TASK_COLS.forEach(function (c) {
    if (fields.hasOwnProperty(c) && c !== 'id' && c !== '_row') t[c] = fields[c];
  });
  sheet_(SHEET.TASKS).getRange(t._row, 1, 1, TASK_COLS.length).setValues([taskToRow(t)]);
  return t;
}

/**
 * Смена статуса задачи с метками времени и идемпотентностью:
 * повторный переход в тот же статус — no-op (возвращает {changed:false}).
 */
function updateTaskStatus(id, newStatus) {
  if (TASK_STATUSES.indexOf(newStatus) === -1) throw new Error('Неизвестный статус: ' + newStatus);
  var t = getTaskById(id);
  if (!t) throw new Error('Задача ' + id + ' не найдена.');
  if (t.status === newStatus) return { task: t, changed: false };
  var fields = { status: newStatus };
  if (newStatus === 'in_progress') fields.taken_at = nowStr();
  if (newStatus === 'done') fields.done_at = nowStr();
  var updated = updateTask(id, fields);
  logAction('maid', 'task_status', id, newStatus + ' (номер ' + updated.room + ')');
  return { task: updated, changed: true };
}

function deleteTask(id) {
  var t = getTaskById(id);
  if (!t) throw new Error('Задача ' + id + ' не найдена.');
  sheet_(SHEET.TASKS).deleteRow(t._row);
  logAction('admin', 'task_delete', id, 'Номер ' + t.room);
  return true;
}

// ============================================================================
// Tickets — слой данных
// ============================================================================

function readAllTickets_() {
  var sh = sheet_(SHEET.TICKETS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, TICKET_COLS.length).getValues();
  var out = [];
  rows.forEach(function (row, i) {
    if (String(row[0]).trim() === '') return;
    var t = rowToTicket(row);
    t._row = i + 2;
    out.push(t);
  });
  return out;
}

function getTicketsByDate(date) {
  return readAllTickets_().filter(function (t) { return t.date === date; });
}

function getTicketById(id) {
  var all = readAllTickets_();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

/**
 * Создаёт тикет. data: {source: 'maid'|'admin', room, category, description, created_by}.
 */
function createTicket(data) {
  var t = {
    id: nextIdFromIds('tkt_', readAllTickets_().map(function (x) { return x.id; })),
    date: todayStr(),
    source: data.source,
    room: data.room ? String(data.room) : '',
    category: data.category || 'прочее',
    description: data.description || '',
    status: 'new',
    created_by: data.created_by || data.source,
    created_at: nowStr(),
    resolved_at: ''
  };
  sheet_(SHEET.TICKETS).appendRow(ticketToRow(t));
  logAction(t.created_by, 'ticket_create', t.id, 'Номер ' + (t.room || '—') + ': ' + t.description);
  return t;
}

function updateTicketStatus(id, newStatus) {
  if (TICKET_STATUSES.indexOf(newStatus) === -1) throw new Error('Неизвестный статус тикета: ' + newStatus);
  var t = getTicketById(id);
  if (!t) throw new Error('Тикет ' + id + ' не найден.');
  if (t.status === newStatus) return { ticket: t, changed: false };
  t.status = newStatus;
  if (newStatus === 'done') t.resolved_at = nowStr();
  sheet_(SHEET.TICKETS).getRange(t._row, 1, 1, TICKET_COLS.length).setValues([ticketToRow(t)]);
  logAction('admin', 'ticket_status', id, newStatus);
  return { ticket: t, changed: true };
}

// ============================================================================
// Log
// ============================================================================

function logAction(actor, action, entity, details) {
  try {
    sheet_(SHEET.LOG).appendRow([nowStr(), actor, action, entity, details || '']);
  } catch (e) {
    // Лог не должен ронять основную операцию.
  }
}
