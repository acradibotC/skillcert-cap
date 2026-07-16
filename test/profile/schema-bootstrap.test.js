const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { ensureSqliteSchema } = require('../../scripts/ensure-sqlite-schema');

function execute(dbPath, sql, parameters = []) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath);
        database.run(sql, parameters, error => {
            database.close(closeError => error || closeError ? reject(error || closeError) : resolve());
        });
    });
}

function selectOne(dbPath, sql, parameters = []) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath);
        database.get(sql, parameters, (error, row) => {
            database.close(closeError => error || closeError ? reject(error || closeError) : resolve(row));
        });
    });
}

test('SQLite bootstrap creates missing profile tables without deleting existing notification data', async t => {
    const dbPath = path.join(os.tmpdir(), `skillcert-schema-${process.pid}-${Date.now()}.sqlite`);
    t.after(() => fs.rmSync(dbPath, { force: true }));

    await execute(dbPath, `
        CREATE TABLE znxr09_db_NotificationRead (
            ID TEXT PRIMARY KEY,
            pernr TEXT,
            notifType TEXT,
            requestId TEXT,
            isRead INTEGER
        )
    `);
    await execute(
        dbPath,
        'INSERT INTO znxr09_db_NotificationRead (ID, pernr, notifType, requestId, isRead) VALUES (?, ?, ?, ?, ?)',
        ['preserve-me', '00000001', 'TEST', 'REQ-1', 1]
    );

    const firstRun = await ensureSqliteSchema({ dbPath });
    const secondRun = await ensureSqliteSchema({ dbPath });

    assert.equal(firstRun.tableCount, 8);
    assert.equal(secondRun.tableCount, 8);
    assert.equal((await selectOne(
        dbPath,
        'SELECT COUNT(*) AS count FROM znxr09_db_NotificationRead WHERE ID = ?',
        ['preserve-me']
    )).count, 1);
    assert.equal((await selectOne(
        dbPath,
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
        ['znxr09_db_ProfileIdentityLinks']
    )).count, 1);
});
