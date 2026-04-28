const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'cinehome.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erro ao abrir banco de dados:', err.message);
    } else {
        console.log('✅ Banco de dados SQLite conectado.');
        initDb();
    }
});

function initDb() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Tabela de Metadados (Filmes e Séries)
            db.run(`CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tmdb_id INTEGER UNIQUE,
                type TEXT NOT NULL, 
                title TEXT NOT NULL,
                year INTEGER,
                poster_path TEXT,
                backdrop_path TEXT,
                overview TEXT,
                rating REAL,
                genres TEXT,
                is_favorite INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Tabela de Arquivos (Episódios ou o arquivo do Filme)
            db.run(`CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_id INTEGER,
                source_index INTEGER,
                path TEXT NOT NULL UNIQUE,
                season INTEGER,
                episode INTEGER,
                watched INTEGER DEFAULT 0,
                progress REAL DEFAULT 0, 
                last_played DATETIME,
                FOREIGN KEY (media_id) REFERENCES media (id) ON DELETE CASCADE
            )`, (err) => {
                if (err) reject(err);
                else {
                    console.log('✅ Tabelas do banco de dados prontas.');
                    resolve();
                }
            });
        });
    });
}

// Inicialização exportada como Promise
const initPromise = new Promise((resolve, reject) => {
    db.on('open', () => {
        console.log('✅ Banco de dados SQLite conectado.');
        initDb().then(resolve).catch(reject);
    });
});

// Funções utilitárias envolvidas em Promises para facilitar o uso no index.js
const dbUtils = {
    initPromise,
    all: (query, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    get: (query, params = []) => {
        return new Promise((resolve, reject) => {
            db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    run: (query, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }
};

module.exports = dbUtils;
