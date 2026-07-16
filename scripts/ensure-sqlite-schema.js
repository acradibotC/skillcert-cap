const cds = require('@sap/cds');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const MODEL_FILES = ['db/schema.cds', 'db/profile.cds'];

function configuredSqlitePath() {
    const db = cds.env.requires?.db;
    const kind = String(db?.kind || '').toLowerCase();
    if (!kind.includes('sqlite')) return null;

    let url = String(db?.credentials?.url || 'db.sqlite');
    if (url === ':memory:' || url.includes(':memory:')) return null;
    url = url.replace(/^sqlite:/i, '');
    return path.isAbsolute(url) ? url : path.resolve(process.cwd(), url);
}

function runSqliteBatch(dbPath, sql) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath, openError => {
            if (openError) return reject(openError);
            database.exec(sql, executionError => {
                database.close(closeError => {
                    if (executionError || closeError) {
                        reject(executionError || closeError);
                    } else {
                        resolve();
                    }
                });
            });
        });
    });
}

async function ensureSqliteSchema(options = {}) {
    const dbPath = options.dbPath || configuredSqlitePath();
    if (!dbPath) {
        return { skipped: true, reason: 'Database is not file-based SQLite.' };
    }

    const modelFiles = options.modelFiles || MODEL_FILES;
    const model = await cds.load(modelFiles);
    const createStatements = cds.compile.to.sql(model, { dialect: 'sqlite' })
        .filter(statement => /^\s*CREATE TABLE\s+/i.test(statement))
        .map(statement => statement.replace(/^\s*CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS '));

    if (createStatements.length === 0) {
        throw new Error('No SQLite table definitions were compiled from the database model.');
    }

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    await runSqliteBatch(dbPath, [
        'BEGIN IMMEDIATE;',
        ...createStatements,
        'COMMIT;'
    ].join('\n'));

    return { skipped: false, dbPath, tableCount: createStatements.length };
}

if (require.main === module) {
    ensureSqliteSchema()
        .then(result => {
            if (result.skipped) {
                console.log(`[db-init] Skipped: ${result.reason}`);
                return;
            }
            console.log(`[db-init] Ensured ${result.tableCount} SQLite tables.`);
        })
        .catch(error => {
            console.error('[db-init] Schema initialization failed:', error.message);
            process.exitCode = 1;
        });
}

module.exports = { ensureSqliteSchema };
