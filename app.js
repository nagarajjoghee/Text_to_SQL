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
    'List employees who joined after 2021 grouped by department with a count per department.',
    'Give me monthly revenue and order count for 2023 for the ecommerce database.',
    'Find products that are out of stock but have pending orders, include product name and order id.',
    'Show average session duration by country for the last 30 days from analytics events.'
];

const MOCK_TABLES = {
    customers: ['customers', 'client', 'buyer', 'customer'],
    orders: ['orders', 'purchases', 'order'],
    employees: ['employees', 'staff', 'team members'],
    products: ['products', 'inventory', 'items', 'catalog'],
    sessions: ['sessions', 'visits', 'analytics', 'events']
};

const COLUMN_HINTS = {
    customers: ['customer_id', 'full_name', 'email', 'created_at', 'total_spent'],
    orders: ['order_id', 'customer_id', 'order_date', 'status', 'total_amount'],
    employees: ['employee_id', 'first_name', 'last_name', 'department', 'hire_date'],
    products: ['product_id', 'product_name', 'stock_quantity', 'status', 'category'],
    sessions: ['session_id', 'country', 'duration_seconds', 'started_at']
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

const TEMPALTE_SQL = {
    default: ({ table, columns, where, groupBy, orderBy, limit }) => `
SELECT
    ${columns.join(',\n    ')}
FROM
    ${table}
${where ? `WHERE\n    ${where}` : ''}
${groupBy ? `GROUP BY\n    ${groupBy}` : ''}
${orderBy ? `ORDER BY\n    ${orderBy}` : ''}
${limit ? `LIMIT ${limit}` : ''};`.trim()
};

function normalizeText(text) {
    return text.toLowerCase();
}

function detectTables(prompt) {
    const normalized = normalizeText(prompt);
    const matches = [];

    Object.entries(MOCK_TABLES).forEach(([table, synonyms]) => {
        if (synonyms.some((variant) => normalized.includes(variant))) {
            matches.push(table);
        }
    });

    return matches.length ? matches : ['orders'];
}

function detectColumns(table) {
    return COLUMN_HINTS[table] ?? ['*'];
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

function buildWhereClause(prompt) {
    const filters = [];
    const normalized = normalizeText(prompt);

    if (normalized.includes('2024')) {
        filters.push("YEAR(created_at) = 2024");
    }

    if (normalized.includes('2023')) {
        filters.push("YEAR(order_date) = 2023");
    }

    if (/last\s+(\d+)\s+days/i.test(prompt)) {
        const days = prompt.match(/last\s+(\d+)\s+days/i)[1];
        filters.push(`created_at >= CURRENT_DATE - INTERVAL '${days} days'`);
    }

    if (/after\s+(\d{4})/i.test(prompt)) {
        const year = prompt.match(/after\s+(\d{4})/i)[1];
        filters.push(`created_at >= DATE '${year}-01-01'`);
    }

    if (normalized.includes('out of stock')) {
        filters.push("stock_quantity = 0");
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

function buildExplanation({ tables, where, groupBy, aggregations, limit }) {
    const items = [];

    items.push(`Detected target table: ${tables.join(', ')}`);

    if (aggregations.length) {
        items.push(`Applied aggregations: ${aggregations.join(', ')}`);
    }

    if (where) {
        items.push('Added filters based on temporal or keyword hints.');
    }

    if (groupBy) {
        items.push(`Grouped results by ${groupBy}.`);
    }

    if (limit) {
        items.push(`Limited results to top ${limit}.`);
    }

    return items;
}

function convertPromptToSql(prompt) {
    const tables = detectTables(prompt);
    const primaryTable = tables[0];
    const aggregations = detectAggregations(prompt);
    const columns = selectColumns(prompt, primaryTable, aggregations);
    const where = buildWhereClause(prompt);
    const groupBy = buildGroupBy(prompt, columns);
    const orderBy = buildOrderBy(prompt, columns);
    const limit = parseLimit(prompt);

    const sql = TEMPALTE_SQL.default({
        table: primaryTable,
        columns,
        where,
        groupBy,
        orderBy,
        limit
    });

    return {
        sql,
        explanation: buildExplanation({ tables, where, groupBy, aggregations, limit })
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

