const serverTypeInput = document.getElementById('serverType');
const serverListElement = document.getElementById('serverList');
const serverTitle = document.getElementById('serverTitle');
const serverMeta = document.getElementById('serverMeta');
const createServerButton = document.getElementById('createServer');
const serverNameInput = document.getElementById('serverName');
const serverHostInput = document.getElementById('serverHost');
const serverPortInput = document.getElementById('serverPort');
const serverUserInput = document.getElementById('serverUser');
const serverPasswordInput = document.getElementById('serverPassword');
const serverDatabaseInput = document.getElementById('serverDatabase');
const serverFilePathInput = document.getElementById('serverFilePath');
const deleteServerButton = document.getElementById('deleteServer');
const refreshStatusButton = document.getElementById('refreshStatus');
const runQueryButton = document.getElementById('runQuery');
const loadTablesButton = document.getElementById('loadTables');
const sqlQuery = document.getElementById('sqlQuery');
const tableList = document.getElementById('tableList');
const queryResult = document.getElementById('queryResult');
const serverStatus = document.getElementById('serverStatus');

let servers = [];
let activeServer = null;

const STORAGE_KEY = 'sql_servers';

function updateFormFields() {
  const type = serverTypeInput.value;
  const isSqlite = type === 'sqlite';
  serverHostInput.style.display = isSqlite ? 'none' : 'block';
  serverPortInput.style.display = isSqlite ? 'none' : 'block';
  serverUserInput.style.display = isSqlite ? 'none' : 'block';
  serverPasswordInput.style.display = isSqlite ? 'none' : 'block';
  serverDatabaseInput.style.display = isSqlite ? 'none' : 'block';
  serverFilePathInput.style.display = isSqlite ? 'block' : 'none';
}

function loadServersFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveServersToStorage(serversList) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serversList));
}

function fetchServers() {
  servers = loadServersFromStorage();
  renderServerList();
}

function renderServerList() {
  serverListElement.innerHTML = '';
  if (servers.length === 0) {
    serverListElement.innerHTML = '<p class="empty-state">No saved server connections yet.</p>';
    selectServer(null);
    return;
  }

  servers.forEach((server) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'server-item';
    item.textContent = `${server.name} (${server.type})`;
    item.addEventListener('click', () => selectServer(server));

    if (activeServer?.id === server.id) {
      item.classList.add('active');
    }

    serverListElement.appendChild(item);
  });

  if (!activeServer || !servers.some((server) => server.id === activeServer.id)) {
    selectServer(servers[0]);
  }
}

function renderStatus(message, isError = false) {
  serverStatus.innerHTML = `<div class="${isError ? 'error-message' : 'result-message'}">${message}</div>`;
}

async function selectServer(server) {
  activeServer = server;
  if (!server) {
    serverTitle.textContent = 'No server selected';
    serverMeta.textContent = 'Create a connection to begin.';
    deleteServerButton.disabled = true;
    refreshStatusButton.disabled = true;
    runQueryButton.disabled = true;
    loadTablesButton.disabled = true;
    tableList.innerHTML = 'No server selected.';
    queryResult.innerHTML = 'Run a command to see the result here.';
    renderStatus('Select a server to inspect status.');
    return;
  }

  serverTitle.textContent = server.name;
  serverMeta.textContent = `${server.type.toUpperCase()} ${server.host ? `${server.host}:${server.port}` : server.filePath || 'local file'}`;
  deleteServerButton.disabled = false;
  refreshStatusButton.disabled = false;
  runQueryButton.disabled = false;
  loadTablesButton.disabled = false;
  renderServerList();
  loadTables();
  loadStatus();
}

async function testConnection(server) {
  try {
    const response = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(server),
    });

    if (!response.ok) {
      const json = await response.json();
      return { success: false, error: json.error || 'Connection failed.' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` };
  }
}

async function createServer() {
  const type = serverTypeInput.value;
  const name = serverNameInput.value.trim();
  const host = serverHostInput.value.trim();
  const port = serverPortInput.value.trim();
  const user = serverUserInput.value.trim();
  const password = serverPasswordInput.value;
  const database = serverDatabaseInput.value.trim();
  const filePath = serverFilePathInput.value.trim();

  if (!name) {
    renderStatus('Error: Enter a connection name.', true);
    return;
  }

  if (type !== 'sqlite' && (!host || !user)) {
    renderStatus('Error: Host and user are required for MySQL/PostgreSQL.', true);
    return;
  }

  renderStatus('Testing connection...');
  const testServer = { type, name, host, port, user, password, database, filePath };
  const result = await testConnection(testServer);

  if (!result.success) {
    renderStatus(`Error: ${result.error}`, true);
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const server = { id, type, name, host, port, user, password, database, filePath, createdAt: new Date().toISOString() };

  servers.push(server);
  saveServersToStorage(servers);

  serverNameInput.value = '';
  serverHostInput.value = '';
  serverPortInput.value = '';
  serverUserInput.value = '';
  serverPasswordInput.value = '';
  serverDatabaseInput.value = '';
  serverFilePathInput.value = '';

  renderStatus(`Connection "${name}" created successfully!`);
  fetchServers();
  selectServer(server);
}

function deleteServer() {
  if (!activeServer || !confirm(`Delete connection "${activeServer.name}"?`)) {
    return;
  }

  servers = servers.filter((s) => s.id !== activeServer.id);
  saveServersToStorage(servers);

  activeServer = null;
  fetchServers();
}

async function loadStatus() {
  if (!activeServer) {
    return;
  }

  renderStatus('Loading server status...');
  try {
    const response = await fetch(`/api/servers/${activeServer.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: activeServer }),
    });
    const json = await response.json();
    if (!response.ok) {
      renderStatus(`Error: ${json.error || 'Unable to load server status.'}`, true);
      return;
    }

    renderStatus(`Type: ${json.type.toUpperCase()}<br>Version: ${json.version || 'unknown'}<br>Host: ${json.host}<br>Database: ${json.database}`);
  } catch (err) {
    renderStatus(`Error: ${err.message}`, true);
  }
}

async function loadTables() {
  if (!activeServer) {
    return;
  }

  try {
    const response = await fetch(`/api/servers/${activeServer.id}/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: activeServer }),
    });
    if (!response.ok) {
      const json = await response.json();
      renderStatus(`Error: ${json.error || 'Unable to load tables.'}`, true);
      return;
    }

    const json = await response.json();
    if (!json.tables.length) {
      tableList.innerHTML = '<p class="empty-state">No tables found.</p>';
      return;
    }

    tableList.innerHTML = '';
    json.tables.forEach((table) => {
      const item = document.createElement('div');
      item.className = 'table-item';
      item.innerHTML = `<strong>${table.name}</strong> <span>${table.type}</span>`;
      tableList.appendChild(item);
    });
  } catch (err) {
    tableList.innerHTML = `<p class="empty-state">Error: ${err.message}</p>`;
  }
}

async function runQuery() {
  if (!activeServer) {
    return;
  }

  const sql = sqlQuery.value.trim();
  if (!sql) {
    alert('Write a query or command to execute.');
    return;
  }

  queryResult.innerHTML = 'Running command...';
  try {
    const response = await fetch(`/api/servers/${activeServer.id}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: activeServer, sql }),
    });

    const json = await response.json();
    if (!response.ok) {
      queryResult.innerHTML = `<div class="error-message">${json.error || 'Command failed.'}</div>`;
      return;
    }

    if (json.rows) {
      if (!json.rows.length) {
        queryResult.innerHTML = '<div class="result-message">Command returned no rows.</div>';
        return;
      }

      const table = document.createElement('table');
      table.className = 'result-table';
      const header = document.createElement('tr');

      json.columns.forEach((column) => {
        const th = document.createElement('th');
        th.textContent = column;
        header.appendChild(th);
      });
      table.appendChild(header);

      json.rows.forEach((row) => {
        const tr = document.createElement('tr');
        json.columns.forEach((column) => {
          const td = document.createElement('td');
          td.textContent = row[column] ?? '';
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });

      queryResult.innerHTML = '';
      queryResult.appendChild(table);
    } else {
      queryResult.innerHTML = `<div class="result-message">Changes: ${json.changes ?? 0}${json.lastInsertRowid ? `, Insert ID: ${json.lastInsertRowid}` : ''}</div>`;
      await loadTables();
    }
  } catch (err) {
    queryResult.innerHTML = `<div class="error-message">Error: ${err.message}</div>`;
  }
}

serverTypeInput.addEventListener('change', updateFormFields);
createServerButton.addEventListener('click', createServer);
refreshStatusButton.addEventListener('click', loadStatus);
runQueryButton.addEventListener('click', runQuery);
loadTablesButton.addEventListener('click', loadTables);
deleteServerButton.addEventListener('click', deleteServer);

sqlQuery.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = sqlQuery.selectionStart;
    const end = sqlQuery.selectionEnd;
    sqlQuery.value = sqlQuery.value.substring(0, start) + '\t' + sqlQuery.value.substring(end);
    sqlQuery.selectionStart = sqlQuery.selectionEnd = start + 1;
  }
});

updateFormFields();
fetchServers();
