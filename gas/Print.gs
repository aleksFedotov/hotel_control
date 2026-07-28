// ================== Print.gs — печатный лист уборки ==================
// Структура — 1-в-1 по образцу «Лист Уборки.xlsx»:
// заголовок «Дата:», две колонки (Выезды: №, Статус | Заезды: №, Время прибытия, Комментарий),
// внизу строки Текущая/пыль, Полы/Влаж.уб., Белье.

/**
 * Данные печатного листа на дату.
 * Возвращает {date, dateRu, rows: [{room, checkoutStatus, checkinTime, checkinComment}], bottom: {current, wet, linen}}.
 * checkoutStatus: 'свободен' | 'убирается' | 'готов' (пустая строка, если выезда нет и статус не нужен — нет,
 * «свободен» означает «выезда нет»).
 */
function getPrintSheetData(pin, date) {
  requirePin_(pin);
  date = date || todayStr();
  var tasks = getTasksByDate(date);
  var byRoom = {};
  tasks.forEach(function (t) {
    if (t.type === 'выезд') byRoom[t.room] = t;
  });
  var rows = getRooms().map(function (r) {
    var t = byRoom[r.room];
    var status = 'свободен';
    var checkinTime = '', checkinComment = '';
    if (t) {
      if (t.has_checkout === 'да') {
        status = t.status === 'done' ? 'готов' : 'убирается';
      } else {
        status = ''; // заезд без выезда — статуса в колонке «Выезды» нет
      }
      checkinTime = t.checkin_time || '';
      checkinComment = printComment_(t);
    }
    return { room: r.room, checkoutStatus: status, checkinTime: checkinTime, checkinComment: checkinComment };
  });
  return {
    date: date,
    dateRu: fmtDateRu(date),
    rows: rows,
    bottom: {
      current: roomsOfType_(tasks, 'текущая'),
      wet: roomsOfType_(tasks, 'влажная'),
      linen: roomsOfType_(tasks, 'бельё')
    }
  };
}

function roomsOfType_(tasks, type) {
  return tasks.filter(function (t) { return t.type === type; })
    .map(function (t) { return t.room; }).join(', ');
}

/** Комментарий к заезду: гости/подготовка/список/комментарий одной строкой. */
function printComment_(t) {
  var parts = [];
  if (t.guests) parts.push('гостей: ' + t.guests);
  if (t.prep_for) parts.push('на ' + t.prep_for);
  if (t.guest_list) parts.push(t.guest_list);
  if (t.comment) parts.push(t.comment);
  return parts.join('; ');
}

/**
 * Перезаполняет лист «Print» в таблице (для печати прямо из Google Sheets).
 * Запускать вручную из редактора или из веб-приложения.
 */
function regeneratePrintSheet(pin, date) {
  requirePin_(pin);
  var data = getPrintSheetData(pin, date);
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Print');
  if (!sh) sh = ss.insertSheet('Print');
  sh.clear();
  sh.getRange('A1:F1').merge().setValue('Дата: ' + data.dateRu);
  sh.getRange('A2:B2').merge().setValue('Выезды');
  sh.getRange('C2:F2').merge().setValue('Заезды');
  sh.getRange('A3').setValue('№');
  sh.getRange('B3').setValue('Статус');
  sh.getRange('C3').setValue('№');
  sh.getRange('D3').setValue('Время прибытия');
  sh.getRange('E3:F3').merge().setValue('Комментарий');
  var r = 4;
  data.rows.forEach(function (row) {
    sh.getRange(r, 1).setValue(row.checkoutStatus !== '' ? row.room : '');
    sh.getRange(r, 2).setValue(row.checkoutStatus);
    sh.getRange(r, 3).setValue(row.checkinTime || row.checkinComment ? row.room : '');
    sh.getRange(r, 4).setValue(row.checkinTime);
    sh.getRange(r, 5, 1, 2).merge().setValue(row.checkinComment);
    r++;
  });
  r++; // пустая строка-разделитель
  sh.getRange(r, 1).setValue('Текущая/пыль');
  sh.getRange(r, 2, 1, 5).merge().setValue(data.bottom.current);
  sh.getRange(r + 1, 1).setValue('Полы/Влаж.уб.');
  sh.getRange(r + 1, 2, 1, 5).merge().setValue(data.bottom.wet);
  sh.getRange(r + 2, 1).setValue('Белье');
  sh.getRange(r + 2, 2, 1, 5).merge().setValue(data.bottom.linen);
  sh.getRange('A1:F' + (r + 2)).setBorder(true, true, true, true, true, true);
  return 'Лист Print обновлён на ' + data.dateRu;
}
