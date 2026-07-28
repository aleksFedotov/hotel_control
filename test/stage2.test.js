/** Этап 2: юнит-тесты Telegram-транспорта (escapeHtml, splitMessage, tgApi-вызовы). */
const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./loadGas');
const vm = require('vm');

const j = (x) => JSON.parse(JSON.stringify(x));

/** Загружает Code.gs + Telegram.gs с записывающей заглушкой UrlFetchApp. */
function loadTg(settings) {
  const { ctx, sheets } = loadGas(['Code.gs', 'Telegram.gs'], {
    Settings: [['key', 'value'], ...Object.entries(settings || { BOT_TOKEN: 'TESTTOKEN' })]
  });
  const calls = [];
  // Переопределяем UrlFetchApp в песочнице: записываем вызовы, возвращаем ok-ответ.
  ctx.UrlFetchApp = {
    fetch: (url, params) => {
      calls.push({ url, payload: JSON.parse(params.payload) });
      const method = url.split('/').pop();
      const result = method === 'sendMessage' ? { message_id: 100 + calls.length } : true;
      return { getContentText: () => JSON.stringify({ ok: true, result }), getResponseCode: () => 200 };
    }
  };
  return { ctx, sheets, calls };
}

test('escapeHtml — экранирует & < > "', () => {
  const { ctx } = loadTg();
  assert.strictEqual(ctx.escapeHtml('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  assert.strictEqual(ctx.escapeHtml(''), '');
  assert.strictEqual(ctx.escapeHtml(null), '');
});

test('splitMessage — короткий текст не режется', () => {
  const { ctx } = loadTg();
  assert.deepStrictEqual(j(ctx.splitMessage('привет')), ['привет']);
});

test('splitMessage — режет по переносам, не разрывая строки', () => {
  const { ctx } = loadTg();
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push('строка ' + i); // по 9 символов
  const parts = j(ctx.splitMessage(lines.join('\n'), 40));
  assert.ok(parts.length > 1);
  parts.forEach((p) => assert.ok(p.length <= 40));
  // все строки сохранились целиком
  assert.strictEqual(parts.join('\n'), lines.join('\n'));
});

test('splitMessage — строка длиннее лимита режется жёстко', () => {
  const { ctx } = loadTg();
  const parts = j(ctx.splitMessage('x'.repeat(95), 40));
  assert.deepStrictEqual(parts.map((p) => p.length), [40, 40, 15]);
});

test('tgSendMessage — один вызов с parse_mode HTML и клавиатурой', () => {
  const { ctx, calls } = loadTg();
  const msgId = ctx.tgSendMessage(777, '<b>Тест</b>', { keyboard: [[ctx.tgBtn('Ок', 'x|1')]] });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.telegram.org/botTESTTOKEN/sendMessage');
  const p = calls[0].payload;
  assert.strictEqual(p.chat_id, 777);
  assert.strictEqual(p.parse_mode, 'HTML');
  assert.strictEqual(p.reply_markup.inline_keyboard[0][0].callback_data, 'x|1');
  assert.ok(msgId >= 100);
});

test('tgSendMessage — длинный текст режется, клавиатура на последнем сообщении', () => {
  const { ctx, calls } = loadTg();
  ctx.tgSendMessage(1, 'x'.repeat(5000), { keyboard: [[ctx.tgBtn('K', 'k')]] });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].payload.reply_markup, undefined);
  assert.ok(calls[1].payload.reply_markup);
});

test('tgApi — бросает ошибку при ok:false', () => {
  const { ctx } = loadTg();
  ctx.UrlFetchApp = { fetch: () => ({ getContentText: () => JSON.stringify({ ok: false, description: 'chat not found' }), getResponseCode: () => 400 }) };
  assert.throws(() => ctx.tgSendMessage(1, 'hi'), /chat not found/);
});

test('tgApi — без BOT_TOKEN бросает ошибку до fetch', () => {
  const { ctx, calls } = loadTg({});
  assert.throws(() => ctx.tgSendMessage(1, 'hi'), /BOT_TOKEN/);
  assert.strictEqual(calls.length, 0);
});

test('tgAnswerCallback / tgEditKeyboard', () => {
  const { ctx, calls } = loadTg();
  ctx.tgAnswerCallback('cbq_1', 'Принято');
  assert.deepStrictEqual(j(calls[0].payload), { callback_query_id: 'cbq_1', text: 'Принято' });
  ctx.tgEditKeyboard(777, 55, null); // убрать кнопки
  assert.deepStrictEqual(j(calls[1].payload.reply_markup), { inline_keyboard: [] });
});

test('taskKeyboard — набор кнопок по статусу', () => {
  const { ctx } = loadTg();
  const pending = j(ctx.taskKeyboard('task_1', 'pending'));
  assert.strictEqual(pending.length, 2);
  assert.strictEqual(pending[0][0].callback_data, 'ip|task_1');
  const inProgress = j(ctx.taskKeyboard('task_1', 'in_progress'));
  assert.strictEqual(inProgress.length, 1);
  assert.strictEqual(inProgress[0][0].callback_data, 'done|task_1');
  assert.deepStrictEqual(j(ctx.taskKeyboard('task_1', 'done')), []);
});

test('tgRepinPlan — отпин старого, пин нового, запись в Settings', () => {
  const { ctx, sheets, calls } = loadTg({
    BOT_TOKEN: 'T', PINNED_PLAN_MSG: '10', PINNED_PLAN_CHAT: '777'
  });
  ctx.tgRepinPlan(777, 42);
  const methods = calls.map((c) => c.url.split('/').pop());
  assert.deepStrictEqual(methods, ['unpinChatMessage', 'pinChatMessage']);
  assert.strictEqual(ctx.getSetting('PINNED_PLAN_MSG'), '42');
  assert.strictEqual(ctx.getSetting('PINNED_PLAN_CHAT'), '777');
});

test('tgRepinPlan — без старого пина только пинит', () => {
  const { ctx, calls } = loadTg({ BOT_TOKEN: 'T' });
  ctx.tgRepinPlan(777, 42);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].url.endsWith('pinChatMessage'));
});

test('setupWebhook — URL с секретом', () => {
  const { ctx, calls } = loadTg({
    BOT_TOKEN: 'T', WEB_APP_URL: 'https://script.google.com/x/exec', WEBHOOK_SECRET: 'abc123'
  });
  const res = ctx.setupWebhook();
  assert.strictEqual(calls[0].payload.url, 'https://script.google.com/x/exec?tg=1&secret=abc123');
  assert.ok(res.indexOf('Webhook установлен') === 0);
});

test('notifyAdmin / notifyMaid — молчат без chat_id', () => {
  const { ctx, calls } = loadTg({ BOT_TOKEN: 'T' });
  ctx.notifyAdmin('тест');
  ctx.notifyMaid('тест');
  assert.strictEqual(calls.length, 0);
  ctx.setSetting('ADMIN_CHAT_ID', '111');
  ctx.notifyAdmin('тест');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].payload.chat_id, '111');
});
