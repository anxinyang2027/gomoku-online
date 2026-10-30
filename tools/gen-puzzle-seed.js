const fs = require('fs');
const path = require('path');

const SRC = 'D:/gomolu/qianduan/gomoku-web/js/puzzles-data.js';
const OUT = require('path').join(__dirname, '..', 'src', 'main', 'resources', 'db', 'puzzle-seed.sql');

const raw = fs.readFileSync(SRC, 'utf8');
const marker = raw.indexOf('PUZZLE_DATA');
const start = raw.indexOf('=', marker);
const end = raw.lastIndexOf(';');
const data = JSON.parse(raw.slice(start + 1, end));

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
const rows = [];
for (const modeKey of Object.keys(data)) {
  data[modeKey].forEach((lv, i) => {
    rows.push(
      "('" + esc(lv.id) + "','" + esc(modeKey) + "'," + (i + 1) + ",'" + esc(lv.name) +
      "','" + esc(lv.flavor) + "','" + esc(lv.hint) + "','" + esc(JSON.stringify(lv.preset)) +
      "','" + esc(JSON.stringify(lv.steps)) + "')"
    );
  });
}

let sql = 'USE gomoku;\n\n';
const CHUNK = 25;
for (let i = 0; i < rows.length; i += CHUNK) {
  sql += 'INSERT INTO puzzle (id, mode, sort_no, name, flavor, hint, preset, steps) VALUES\n' +
    rows.slice(i, i + CHUNK).join(',\n') + ';\n';
}

fs.writeFileSync(OUT, sql, 'utf8');
console.log('rows =', rows.length, '->', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' KB');
