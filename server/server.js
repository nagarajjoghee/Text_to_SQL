import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'playground.db');

function ensureDataDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function bootstrapDatabase() {
    ensureDataDirectory();
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
            customer_id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'active',
            total_spent NUMERIC DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            order_date TEXT DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending',
            total_amount NUMERIC DEFAULT 0,
            FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        );

        CREATE TABLE IF NOT EXISTS products (
            product_id INTEGER PRIMARY KEY,
            product_name TEXT NOT NULL,
            category TEXT,
            stock_quantity INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            last_restocked TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const customerCount = db.prepare('SELECT COUNT(*) as count FROM customers').get().count;
    if (customerCount === 0) {
        const insertCustomer = db.prepare(`
            INSERT INTO customers (full_name, email, status, total_spent, created_at)
            VALUES (@full_name, @email, @status, @total_spent, @created_at)
        `);

        const customers = [
            {
                full_name: 'Alice Johnson',
                email: 'alice@example.com',
                status: 'active',
                total_spent: 1250.45,
                created_at: '2023-01-15 10:00:00'
            },
            {
                full_name: 'Brian Chen',
                email: 'brian@example.com',
                status: 'active',
                total_spent: 980.0,
                created_at: '2023-05-24 09:14:00'
            },
            {
                full_name: 'Carmen Diaz',
                email: 'carmen@example.com',
                status: 'inactive',
                total_spent: 640.9,
                created_at: '2022-11-05 16:33:00'
            }
        ];

        const insertOrder = db.prepare(`
            INSERT INTO orders (customer_id, order_date, status, total_amount)
            VALUES (@customer_id, @order_date, @status, @total_amount)
        `);

        const orders = [
            { customer_id: 1, order_date: '2024-01-05', status: 'completed', total_amount: 450.25 },
            { customer_id: 1, order_date: '2024-02-18', status: 'completed', total_amount: 800.2 },
            { customer_id: 2, order_date: '2024-03-02', status: 'pending', total_amount: 300.5 },
            { customer_id: 3, order_date: '2023-12-21', status: 'cancelled', total_amount: 120.0 }
        ];

        const insertProduct = db.prepare(`
            INSERT INTO products (product_name, category, stock_quantity, status, last_restocked)
            VALUES (@product_name, @category, @stock_quantity, @status, @last_restocked)
        `);

        const products = [
            { product_name: 'Aurora Hoodie', category: 'Apparel', stock_quantity: 42, status: 'active', last_restocked: '2024-03-10' },
            { product_name: 'Eclipse Backpack', category: 'Gear', stock_quantity: 0, status: 'out_of_stock', last_restocked: '2023-11-05' },
            { product_name: 'Lumen Watch', category: 'Accessories', stock_quantity: 17, status: 'active', last_restocked: '2024-04-28' }
        ];

        const tx = db.transaction(() => {
            customers.forEach((customer) => insertCustomer.run(customer));
            orders.forEach((order) => insertOrder.run(order));
            products.forEach((product) => insertProduct.run(product));
        });

        tx();
    }

    return db;
}

function validateSelect(sql) {
    if (!sql || typeof sql !== 'string') {
        return { valid: false, reason: 'SQL is required.' };
    }

    const trimmed = sql.trim();
    if (!/^select/i.test(trimmed)) {
        return { valid: false, reason: 'Only SELECT statements are allowed.' };
    }

    const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|execute|attach|pragma)\b/i;
    if (forbidden.test(trimmed)) {
        return { valid: false, reason: 'Statement contains forbidden keywords.' };
    }

    const semicolons = trimmed.split(';').filter(Boolean);
    if (semicolons.length > 1) {
        return { valid: false, reason: 'Only a single statement is allowed.' };
    }

    return { valid: true };
}

const db = bootstrapDatabase();
const app = express();

app.use(
    cors({
        origin: true,
        credentials: false
    })
);
app.use(express.json({ limit: '1mb' }));

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        openAIConfigured: Boolean(openai),
        sampleData: db.prepare('SELECT COUNT(*) AS customers FROM customers').get()
    });
});

app.post('/api/text-to-sql', async (req, res) => {
    if (!openai) {
        return res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const { prompt, schemaHints } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    try {
        const response = await openai.responses.create({
            model: 'gpt-4.1',
            input: [
                {
                    role: 'system',
                    content:
                        'You translate natural language requests into SQL for a SQLite database. Return only SQL code. Prefer SELECT statements unless user explicitly asks otherwise. Use provided schema hints.'
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        prompt,
                        schemaHints
                    })
                }
            ],
            max_output_tokens: 600
        });

        const sql = (response.output_text || '').trim();

        if (!sql) {
            return res.status(502).json({ error: 'OpenAI returned an empty response.' });
        }

        res.json({ sql });
    } catch (error) {
        console.error('OpenAI error:', error);
        res.status(500).json({ error: 'Failed to generate SQL with OpenAI.' });
    }
});

app.post('/api/run-sql', (req, res) => {
    const { sql } = req.body ?? {};
    const validation = validateSelect(sql);

    if (!validation.valid) {
        return res.status(400).json({ error: validation.reason });
    }

    try {
        const stmt = db.prepare(sql);
        const rows = stmt.all();
        const columns = stmt.columns().map((col) => col.name);

        res.json({
            columns,
            rows
        });
    } catch (error) {
        console.error('SQL execution error:', error);
        res.status(400).json({ error: error.message || 'Failed to run SQL.' });
    }
});

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
    console.log(`Text-to-SQL server listening on http://localhost:${PORT}`);
});

