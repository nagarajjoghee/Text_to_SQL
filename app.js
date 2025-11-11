const promptInput = document.getElementById('promptInput');
const convertBtn = document.getElementById('convertBtn');
const clearPromptBtn = document.getElementById('clearPromptBtn');
const tryExampleBtn = document.getElementById('tryExampleBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const copySqlBtn = document.getElementById('copySqlBtn');
const downloadSqlBtn = document.getElementById('downloadSqlBtn');
const sqlOutput = document.getElementById('sqlOutput');
const statusLabel = document.getElementById('statusLabel');
const explanationSection = document.getElementById('explanationSection');
const explanationList = document.getElementById('explanationList');
const examplesGrid = document.getElementById('examplesGrid');

const EXAMPLE_PROMPTS = [
    'Show me the top 10 customers by total spending in 2024 including their email and total amount spent.',
    'Insert a new order for customer 42 with pending status and amount 199.99.',
    'Update employee salaries in the marketing department by 5 percent.',
    'Delete cancelled orders older than 90 days.',
    'Create a table for product reviews with rating and comment columns.',
    'Alter the products table to add a column for last_restocked date.',
    'Drop the sessions table if it exists.',
    'Create a view that shows customers with their total orders.',
    'List customers with their latest order date using a join.'
];

const MOCK_TABLES = {
    customers: ['customers', 'client', 'buyer', 'customer'],
    orders: ['orders', 'purchases', 'order'],
    employees: ['employees', 'staff', 'team members', 'employee'],
    products: ['products', 'inventory', 'items', 'catalog', 'product'],
    sessions: ['sessions', 'visits', 'analytics', 'events', 'session'],
    reviews: ['reviews', 'feedback', 'ratings', 'review']
};

const COLUMN_HINTS = {
    customers: ['customer_id', 'full_name', 'email', 'created_at', 'total_spent', 'status'],
    orders: ['order_id', 'customer_id', 'order_date', 'status', 'total_amount'],
    employees: ['employee_id', 'first_name', 'last_name', 'department', 'hire_date', 'salary'],
    products: ['product_id', 'product_name', 'stock_quantity', 'status', 'category', 'last_restocked'],
    sessions: ['session_id', 'customer_id', 'country', 'duration_seconds', 'started_at'],
    reviews: ['review_id', 'product_id', 'rating', 'comment', 'created_at']
};

const AGGREGATIONS = [
    { keyword: 'count', sql: 'COUNT(*)' },
    { keyword: 'total', sql: 'SUM' },
    { keyword: 'sum', sql: 'SUM' },
    { keyword: 'average', sql: 'AVG' },
    { keyword: 'avg', sql: 'AVG' },
    { keyword: 'minimum', sql: 'MIN' },
    { keyword: 'maximum', sql: 'MAX' },
    { keyword: 'min', sql: 'MIN' },
    { keyword: 'max', sql: 'MAX' }
];

const SQL_TEMPLATES = {
    select: ({ table, columns, joins, where, groupBy, orderBy, limit }) => `
SELECT
    ${columns.join(',\n    ')}
FROM
    ${table}
${joins ? `${joins}\n` : ''}${where ? `WHERE\n    ${where}\n` : ''}${groupBy ? `GROUP BY\n    ${groupBy}\n` : ''}${
        orderBy ? `ORDER BY\n    ${orderBy}\n` : ''
    }${limit ? `LIMIT ${limit}` : ''};`.trim(),
    insert: ({ table, columns, values }) => `
INSERT INTO ${table} (
    ${columns.join(',\n    ')}
)
VALUES (
    ${values.join(',\n    ')}
);`.trim(),
    update: ({ table, assignments, where }) => `
UPDATE ${table}
SET
    ${assignments.join(',\n    ')}
${where ? `WHERE\n    ${where}` : ''};`.trim(),
    delete: ({ table, where }) => `
DELETE FROM ${table}
${where ? `WHERE\n    ${where}` : ''};`.trim(),
    createTable: ({ table, columns }) => `
CREATE TABLE ${table} (
    ${columns.join(',\n    ')}
);`.trim(),
    alterTable: ({ table, operations }) => `
ALTER TABLE ${table}
    ${operations.join(',\n    ')};`.trim(),
    dropTable: ({ table }) => `
DROP TABLE IF EXISTS ${table};`.trim(),
    createView: ({ viewName, selectSql }) => `
CREATE OR REPLACE VIEW ${viewName} AS
${selectSql}
;`.trim()
};

function normalizeText(text) {
    return text.toLowerCase();
}

function detectIntent(prompt) {
    const normalized = normalizeText(prompt);

    if (/drop\s+table/i.test(normalized)) {
        return 'drop-table';
    }

    if (/alter\s+table|add\s+column|drop\s+column|rename\s+column/i.test(normalized)) {
        return 'alter-table';
    }

    if (/create\s+view/i.test(normalized)) {
        return 'create-view';
    }

    if (/create\s+table|define\s+table|schema/i.test(normalized)) {
        return 'create-table';
    }

    if (/insert|(add|create)\s+(a\s+)?new\s+(row|record|order|customer|entry)/i.test(normalized)) {
        return 'insert';
    }

    if (/update|modify|change|set\s+[a-z_]+\s*=/i.test(normalized)) {
        return 'update';
    }

    if (/delete|remove|drop\s+rows?|purge/i.test(normalized)) {
        return 'delete';
    }

    return 'select';
}

function detectTables(prompt) {
    const normalized = normalizeText(prompt);
    const matches = [];

    Object.entries(MOCK_TABLES).forEach(([table, synonyms]) => {
        if (synonyms.some((variant) => normalized.includes(variant))) {
            matches.push(table);
        }
    });

    if (!matches.length && /view/i.test(normalized)) {
        matches.push('orders');
    }

    return matches.length ? Array.from(new Set(matches)) : ['orders'];
}

function detectColumns(table) {
    return COLUMN_HINTS[table] ?? ['*'];
}

function writableColumns(table) {
    return detectColumns(table).filter((column) => !/_?id$/.test(column));
}

function primaryKeyColumn(table) {
    const candidates = detectColumns(table);
    return (
        candidates.find((column) => /(_id|id)$/.test(column)) ??
        candidates.find((column) => column.includes('id')) ??
        'id'
    );
}

function parseLimit(prompt) {
    const limitRegex = /top\s+(\d+)|first\s+(\d+)|limit\s+(\d+)/i;
    const match = prompt.match(limitRegex);
    if (!match) return null;

    const number = match.slice(1).find(Boolean);
    return Number(number);
}

function detectAggregations(prompt) {
    const normalized = normalizeText(prompt);
    return AGGREGATIONS.filter((item) => normalized.includes(item.keyword)).map((item) => item.sql);
}

function extractNumeric(prompt, pattern, fallback) {
    const match = prompt.match(pattern);
    return match ? match[1] : fallback;
}

function buildWhereClause(prompt) {
    const filters = [];
    const normalized = normalizeText(prompt);

    if (/customer\s+(?:#)?(\d+)/i.test(prompt)) {
        const customerId = extractNumeric(prompt, /customer\s+(?:#)?(\d+)/i);
        filters.push(`customer_id = ${customerId}`);
    }

    if (/order\s+(?:#)?(\d+)/i.test(prompt)) {
        const orderId = extractNumeric(prompt, /order\s+(?:#)?(\d+)/i);
        filters.push(`order_id = ${orderId}`);
    }

    if (normalized.includes('cancelled')) {
        filters.push("status = 'cancelled'");
    }

    if (/older than\s+(\d+)\s+days/i.test(prompt)) {
        const days = extractNumeric(prompt, /older than\s+(\d+)\s+days/i);
        filters.push(`order_date < CURRENT_DATE - INTERVAL '${days} days'`);
    }

    if (normalized.includes('2024')) {
        filters.push("YEAR(created_at) = 2024");
    }

    if (normalized.includes('2023')) {
        filters.push("YEAR(order_date) = 2023");
    }

    if (/last\s+(\d+)\s+days/i.test(prompt)) {
        const days = extractNumeric(prompt, /last\s+(\d+)\s+days/i);
        filters.push(`created_at >= CURRENT_DATE - INTERVAL '${days} days'`);
    }

    if (/after\s+(\d{4})/i.test(prompt)) {
        const year = extractNumeric(prompt, /after\s+(\d{4})/i);
        filters.push(`created_at >= DATE '${year}-01-01'`);
    }

    if (normalized.includes('out of stock')) {
        filters.push('stock_quantity = 0');
    }

    if (normalized.includes('marketing department')) {
        filters.push("department = 'Marketing'");
    }

    return filters.join('\n    AND ');
}

function buildGroupBy(prompt, columns) {
    if (/group(ed)? by/i.test(prompt)) {
        const groupColumns = prompt.match(/group(?:ed)? by\s+([a-z\s,]+)/i)[1];
        return groupColumns
            .split(',')
            .map((token) => token.trim().replace(/\s+/g, '_'))
            .filter(Boolean)
            .join(', ');
    }

    if (columns.some((column) => column.includes('department'))) {
        return 'department';
    }

    if (columns.some((column) => column.includes('country'))) {
        return 'country';
    }

    return '';
}

function buildOrderBy(prompt, columns) {
    if (/latest|most recent|recent/i.test(prompt)) {
        const dateColumn = columns.find((column) => column.includes('date') || column.includes('created'));
        return `${dateColumn ?? columns[0]} DESC`;
    }

    if (/top\s+\d+/i.test(prompt)) {
        const numericColumn = columns.find((column) => column.includes('total') || column.includes('amount'));
        return `${numericColumn ?? columns[0]} DESC`;
    }

    if (/average/i.test(prompt)) {
        const targetColumn = columns.find((column) => column.includes('duration'));
        return `${targetColumn ?? columns[0]} DESC`;
    }

    return '';
}

function selectColumns(prompt, table, aggregations) {
    const candidates = detectColumns(table);

    if (aggregations.length) {
        const dimensionColumns = candidates.filter((column) => !column.includes('_id') && !column.includes('id'));
        const measureColumn =
            candidates.find((column) => column.includes('amount') || column.includes('total')) ?? candidates[0];

        const aggregationColumns = aggregations.map((agg, index) => `${agg}(${measureColumn}) AS metric_${index + 1}`);

        return [...dimensionColumns.slice(0, 2), ...aggregationColumns];
    }

    const normalized = normalizeText(prompt);
    const filtered = candidates.filter((column) => normalized.includes(column.replace(/_/g, ' ')));

    if (filtered.length) {
        return filtered.slice(0, 4);
    }

    return candidates.slice(0, 4);
}

function buildInsertValues(columns) {
    return columns.map((column, index) => {
        if (/date/i.test(column)) return `CURRENT_DATE${index ? ` + INTERVAL '${index} day'` : ''}`;
        if (/amount|total|salary|price|count|quantity/i.test(column)) return String((index + 1) * 100);
        if (/status/i.test(column)) return `'pending'`;
        if (/email/i.test(column)) return `'sample${index + 1}@example.com'`;
        if (/name|title/i.test(column)) return `'Sample ${column.replace(/_/g, ' ')}'`;
        if (/comment|note|description/i.test(column)) return `'Sample ${column.replace(/_/g, ' ')} text'`;
        return `'value_${index + 1}'`;
    });
}

function buildUpdateAssignments(columns) {
    return columns.map((column, index) => {
        if (/amount|total|salary|price|count|quantity/i.test(column)) {
            return `${column} = ${column} * 1.${index + 1}`;
        }

        if (/status/i.test(column)) {
            return `${column} = 'updated_status'`;
        }

        return `${column} = 'new_${column}'`;
    });
}

function buildCreateTableColumns(table, columns) {
    const pk = primaryKeyColumn(table);

    return [
        `${pk} BIGINT PRIMARY KEY`,
        ...columns
            .filter((column) => column !== pk)
            .slice(0, 5)
            .map((column) => {
                if (/date|time/i.test(column)) return `${column} TIMESTAMP`;
                if (/amount|total|salary|price|count|quantity/i.test(column)) return `${column} NUMERIC(12, 2)`;
                if (/status/i.test(column)) return `${column} VARCHAR(32)`;
                if (/email/i.test(column)) return `${column} VARCHAR(255) UNIQUE`;
                if (/name|title/i.test(column)) return `${column} VARCHAR(160)`;
                if (/rating/i.test(column)) return `${column} INT CHECK (${column} BETWEEN 1 AND 5)`;
                if (/comment|description|note/i.test(column)) return `${column} TEXT`;
                return `${column} VARCHAR(120)`;
            })
    ];
}

function buildAlterOperations(prompt, table) {
    const operations = [];
    const normalized = normalizeText(prompt);

    if (/add\s+column\s+([a-z_]+)/i.test(normalized)) {
        const columnName = normalized.match(/add\s+column\s+([a-z_]+)/i)[1];
        operations.push(`ADD COLUMN ${columnName} VARCHAR(120)`);
    }

    if (/add\s+column/i.test(normalized) && !operations.length) {
        operations.push('ADD COLUMN new_column VARCHAR(120)');
    }

    if (/drop\s+column\s+([a-z_]+)/i.test(normalized)) {
        const columnName = normalized.match(/drop\s+column\s+([a-z_]+)/i)[1];
        operations.push(`DROP COLUMN ${columnName}`);
    }

    if (/rename\s+column\s+([a-z_]+)\s+to\s+([a-z_]+)/i.test(normalized)) {
        const [, from, to] = normalized.match(/rename\s+column\s+([a-z_]+)\s+to\s+([a-z_]+)/i);
        operations.push(`RENAME COLUMN ${from} TO ${to}`);
    }

    if (/increase|set\s+default/i.test(normalized)) {
        const candidates = writableColumns(table);
        if (candidates.length) {
            operations.push(`ALTER COLUMN ${candidates[0]} SET DEFAULT 'placeholder'`);
        }
    }

    return operations.length ? operations : ['ADD COLUMN new_attribute TEXT'];
}

function buildJoinClause(tables) {
    if (tables.length < 2) return '';

    const [primary, secondary] = tables;
    const foreignKey = `${secondary.slice(0, -1)}_id`;
    const primaryKey = primaryKeyColumn(primary);

    return `JOIN ${secondary} ON ${primary}.${foreignKey} = ${secondary}.${primaryKeyColumn(secondary)}`;
}

function buildViewName(tables) {
    return `vw_${tables.join('_')}`;
}

function buildExplanation({ intent, tables, where, groupBy, aggregations, limit, joins }) {
    const items = [];

    items.push(`Detected intent: ${intent.toUpperCase()} statement.`);
    items.push(`Primary target table: ${tables[0]}`);

    if (joins) {
        items.push('Added sample JOIN between related tables.');
    }

    if (intent === 'select' && aggregations?.length) {
        items.push(`Applied aggregations: ${aggregations.join(', ')}`);
    }

    if (intent === 'select' && where) {
        items.push('Added filters based on temporal or keyword hints.');
    }

    if (intent === 'select' && groupBy) {
        items.push(`Grouped results by ${groupBy}.`);
    }

    if (intent === 'select' && limit) {
        items.push(`Limited results to top ${limit}.`);
    }

    if (intent === 'insert') {
        items.push('Populated illustrative column values. Replace with real data before running.');
    }

    if (intent === 'update' || intent === 'delete') {
        items.push('Included example WHERE clause to scope the change.');
    }

    if (intent === 'create-table') {
        items.push('Mapped known fields to representative SQL data types.');
    }

    if (intent === 'alter-table') {
        items.push('Generated example ALTER operations (adjust as needed).');
    }

    if (intent === 'drop-table') {
        items.push('Uses IF EXISTS for safe deletion in demos.');
    }

    if (intent === 'create-view') {
        items.push('Wrapped a SELECT statement inside CREATE VIEW.');
    }

    return items;
}

function convertPromptToSql(prompt) {
    const tables = detectTables(prompt);
    const primaryTable = tables[0];
    const intent = detectIntent(prompt);
    const where = buildWhereClause(prompt);

    if (intent === 'insert') {
        const columns = writableColumns(primaryTable).slice(0, 4);
        const values = buildInsertValues(columns);
        return {
            sql: SQL_TEMPLATES.insert({ table: primaryTable, columns, values }),
            explanation: buildExplanation({ intent, tables })
        };
    }

    if (intent === 'update') {
        const columns = writableColumns(primaryTable).slice(0, 3);
        const assignments = buildUpdateAssignments(columns);
        const scopedWhere = where || `${primaryKeyColumn(primaryTable)} = ?`;
        return {
            sql: SQL_TEMPLATES.update({ table: primaryTable, assignments, where: scopedWhere }),
            explanation: buildExplanation({ intent, tables, where: scopedWhere })
        };
    }

    if (intent === 'delete') {
        const scopedWhere = where || `${primaryKeyColumn(primaryTable)} = ?`;
        return {
            sql: SQL_TEMPLATES.delete({ table: primaryTable, where: scopedWhere }),
            explanation: buildExplanation({ intent, tables, where: scopedWhere })
        };
    }

    if (intent === 'create-table') {
        const columns = buildCreateTableColumns(primaryTable, detectColumns(primaryTable));
        return {
            sql: SQL_TEMPLATES.createTable({ table: primaryTable, columns }),
            explanation: buildExplanation({ intent, tables })
        };
    }

    if (intent === 'alter-table') {
        const operations = buildAlterOperations(prompt, primaryTable);
        return {
            sql: SQL_TEMPLATES.alterTable({ table: primaryTable, operations }),
            explanation: buildExplanation({ intent, tables })
        };
    }

    if (intent === 'drop-table') {
        return {
            sql: SQL_TEMPLATES.dropTable({ table: primaryTable }),
            explanation: buildExplanation({ intent, tables })
        };
    }

    if (intent === 'create-view') {
        const viewName = buildViewName(tables);
        const aggregations = detectAggregations(prompt);
        const columns = selectColumns(prompt, primaryTable, aggregations);
        const joins = buildJoinClause(tables);
        const selectSql = SQL_TEMPLATES.select({
            table: primaryTable,
            columns,
            joins,
            where,
            groupBy: buildGroupBy(prompt, columns),
            orderBy: buildOrderBy(prompt, columns)
        });

        return {
            sql: SQL_TEMPLATES.createView({ viewName, selectSql }),
            explanation: buildExplanation({ intent, tables, joins })
        };
    }

    const aggregations = detectAggregations(prompt);
    const columns = selectColumns(prompt, primaryTable, aggregations);
    const joins = buildJoinClause(tables);
    const groupBy = buildGroupBy(prompt, columns);
    const orderBy = buildOrderBy(prompt, columns);
    const limit = parseLimit(prompt);

    return {
        sql: SQL_TEMPLATES.select({
            table: primaryTable,
            columns,
            joins,
            where,
            groupBy,
            orderBy,
            limit
        }),
        explanation: buildExplanation({ intent, tables, where, groupBy, aggregations, limit, joins })
    };
}

function setStatus(message, variant = 'neutral') {
    statusLabel.textContent = message;
    statusLabel.className = `status${variant === 'success' ? ' status--success' : ''}${
        variant === 'error' ? ' status--error' : ''
    }`;
}

function renderSql(sql) {
    sqlOutput.textContent = sql;
    copySqlBtn.disabled = !sql;
    downloadSqlBtn.disabled = !sql;
}

function renderExplanation(explanation) {
    explanationList.innerHTML = '';

    if (!explanation.length) {
        explanationSection.hidden = true;
        return;
    }

    explanation.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        explanationList.appendChild(li);
    });

    explanationSection.hidden = false;
}

function handleConvert() {
    const prompt = promptInput.value.trim();

    if (!prompt) {
        setStatus('Please enter a prompt before converting.', 'error');
        renderSql('');
        renderExplanation([]);
        return;
    }

    const { sql, explanation } = convertPromptToSql(prompt);
    renderSql(sql);
    renderExplanation(explanation);
    setStatus('Mock conversion complete.', 'success');
}

function handleClearPrompt() {
    promptInput.value = '';
    renderSql('');
    renderExplanation([]);
    setStatus('Waiting for prompt…');
    promptInput.focus();
}

async function handleCopySql() {
    try {
        await navigator.clipboard.writeText(sqlOutput.textContent);
        setStatus('SQL copied to clipboard!', 'success');
    } catch (error) {
        console.error(error);
        setStatus('Unable to copy to clipboard in this browser.', 'error');
    }
}

function handleDownloadSql() {
    const blob = new Blob([sqlOutput.textContent], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'query.sql';
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Downloaded query.sql', 'success');
}

function handleExampleClick(example) {
    promptInput.value = example;
    handleConvert();
    promptInput.focus();
}

function hydrateExamples() {
    EXAMPLE_PROMPTS.forEach((example) => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.type = 'button';
        chip.textContent = example;
        chip.addEventListener('click', () => handleExampleClick(example));
        examplesGrid.appendChild(chip);
    });
}

function hydrateTryExample() {
    tryExampleBtn.addEventListener('click', () => {
        const random = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
        handleExampleClick(random);
    });
}

function hydrateClearAll() {
    clearAllBtn.addEventListener('click', () => {
        promptInput.value = '';
        renderSql('');
        renderExplanation([]);
        setStatus('Workspace reset. Ready for your next idea.');
        promptInput.focus();
    });
}

function registerEventListeners() {
    convertBtn.addEventListener('click', handleConvert);
    clearPromptBtn.addEventListener('click', handleClearPrompt);
    copySqlBtn.addEventListener('click', handleCopySql);
    downloadSqlBtn.addEventListener('click', handleDownloadSql);
    promptInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            handleConvert();
        }
    });
}

function init() {
    hydrateExamples();
    hydrateTryExample();
    hydrateClearAll();
    registerEventListeners();
    setStatus('Waiting for prompt…');
}

document.addEventListener('DOMContentLoaded', init);

