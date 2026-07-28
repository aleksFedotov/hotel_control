/**
 * Загружает GAS-файлы в vm-песочницу с in-memory заглушкой SpreadsheetApp.
 * Возвращает { ctx, sheets } — ctx содержит все функции Code.gs.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

/** Простая in-memory таблица: sheets = { имя: [[строка], ...] }. */
function makeSpreadsheetApp(sheets) {
  function makeSheet(name) {
    const rows = sheets[name] || (sheets[name] = []);
    return {
      getName: () => name,
      getLastRow: () => rows.length,
      appendRow: (row) => rows.push(row.slice()),
      deleteRow: (n) => rows.splice(n - 1, 1),
      getRange: (r, c, nr, nc) => {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues: () => {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = rows[r - 1 + i] || [];
              const vals = [];
              for (let j = 0; j < nc; j++) vals.push(row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
              out.push(vals);
            }
            return out;
          },
          setValues: (vals) => {
            for (let i = 0; i < vals.length; i++) {
              while (rows.length < r + i) rows.push([]);
              for (let j = 0; j < vals[i].length; j++) rows[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          },
          setValue: (v) => {
            while (rows.length < r) rows.push([]);
            rows[r - 1][c - 1] = v;
          }
        };
      }
    };
  }
  return {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => (sheets[name] ? makeSheet(name) : null),
      insertSheet: (name) => makeSheet(name)
    }),
    _makeSheet: makeSheet
  };
}

function loadGas(files, initialSheets) {
  const sheets = initialSheets || {};
  const sandbox = {
    SpreadsheetApp: makeSpreadsheetApp(sheets),
    UrlFetchApp: { fetch: () => { throw new Error('UrlFetchApp не заглушен в этом тесте'); } },
    console
  };
  vm.createContext(sandbox);
  files.forEach((f) => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  });
  return { ctx: sandbox, sheets };
}

module.exports = { loadGas, makeSpreadsheetApp };
