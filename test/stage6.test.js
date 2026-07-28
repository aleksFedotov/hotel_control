/** Этап 6: Index.html — doGet отдаёт интерфейс, все вызываемые из UI функции существуют. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadGas } = require('./loadGas');

const j = (x) => JSON.parse(JSON.stringify(x));
const htmlPath = path.join(__dirname, '..', 'gas', 'Index.html');

function loadAll() {
  const { ctx, sheets } = loadGas(['Code.gs', 'Telegram.gs', 'Bot.gs', 'Plan.gs', 'Api.gs', 'Print.gs'], {
    Settings: [['key', 'value'], ['WEBHOOK_SECRET', 'sec'], ['WEB_PIN', '1234']],
    Tasks: [undefined]
  });
  sheets.Tasks = [j(ctx.TASK_COLS)];
  return { ctx };
}

test('Index.html существует и не пустой', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.length > 5000);
  assert.ok(html.indexOf('google.script.run') >= 0);
});

test('doGet без ?tg=1 отдаёт HtmlService.createHtmlOutputFromFile("Index")', () => {
  const { ctx } = loadAll();
  const seen = [];
  ctx.HtmlService = {
    createHtmlOutputFromFile: (name) => {
      seen.push(name);
      return { setTitle: function () { return this; }, addMetaTag: function () { return this; } };
    }
  };
  ctx.ContentService = { createTextOutput: (t) => ({ getContent: () => t }) };
  ctx.doGet({ parameter: {} });
  assert.deepStrictEqual(seen, ['Index']);
});

test('doGet ?tg=1 — health-check webhook, без HtmlService', () => {
  const { ctx } = loadAll();
  ctx.ContentService = { createTextOutput: (t) => ({ getContent: () => t }) };
  ctx.HtmlService = { createHtmlOutputFromFile: () => { throw new Error('не должен вызываться'); } };
  const r = ctx.doGet({ parameter: { tg: '1' } });
  assert.ok(r.getContent().indexOf('webhook жив') >= 0);
});

test('все функции, вызываемые из Index.html через google.script.run, определены в GAS', () => {
  const { ctx } = loadAll();
  const html = fs.readFileSync(htmlPath, 'utf8');
  // Имена из api('...') и прямых вызовов .checkPin(
  const names = new Set();
  for (const m of html.matchAll(/api\('([a-zA-Z]+)'/g)) names.add(m[1]);
  for (const m of html.matchAll(/\.([a-zA-Z]+)\(pin\)/g)) names.add(m[1]);
  assert.ok(names.size >= 9, 'ожидались вызовы api: ' + [...names].join(','));
  for (const n of names) {
    assert.strictEqual(typeof ctx[n], 'function', 'функция ' + n + ' не найдена в GAS');
  }
});

test('PIN из localStorage передаётся первым аргументом (контракт с requirePin_)', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.indexOf("[state.pin].concat(args)") >= 0);
  assert.ok(html.indexOf("localStorage.getItem('hotel_token')") >= 0);
});
