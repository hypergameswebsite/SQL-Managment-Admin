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

async function fetchServers() {
  const response = await fetch('/api/servers');
  const json = await response.json();
  servers = json.servers;
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
    alert('Enter a connection name.');
    return;
  }

  if (type !== 'sqlite' && (!host || !user)) {
    alert('Host and user are required for MySQL/PostgreSQL.');
    return;
  }

  const response = await fetch('/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name, host, port, user, password, database, filePath }),
  });

  const json = await response.json();
  if (!response.ok) {
    alert(json.error || 'Unable to add connection.');
    return;
  }

  serverNameInput.value = '';
  serverHostInput.value = '';
  serverPortInput.value = '';
  serverUserInput.value = '';
  serverPasswordInput.value = '';
  serverDatabaseInput.value = '';
  serverFilePathInput.value = '';

  await fetchServers();
  selectServer(json.server);
}

async function deleteServer() {
  if (!activeServer || !confirm(`Delete connection "${activeServer.name}"?`)) {
    return;
  }

  const response = await fetch(`/api/servers/${activeServer.id}`, { method: 'DELETE' });
  if (!response.ok) {
    const json = await response.json();
    alert(json.error || 'Unable to delete connection.');
    return;
  }

  activeServer = null;
  await fetchServers();
}

async function loadStatus() {
  if (!activeServer) {
    return;
  }

  renderStatus('Loading server status...');
  const response = await fetch(`/api/servers/${activeServer.id}/status`);
  const json = await response.json();
  if (!response.ok) {
    renderStatus(json.error || 'Unable to load server status.', true);
    return;
  }

  renderStatus(`Type: ${json.type.toUpperCase()}<br>Version: ${json.version || 'unknown'}<br>Host: ${json.host}<br>Database: ${json.database}`);
}

async function loadTables() {
  if (!activeServer) {
    return;
  }

  const response = await fetch(`/api/servers/${activeServer.id}/tables`);
  if (!response.ok) {
    const json = await response.json();
    renderStatus(json.error || 'Unable to load tables.', true);
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
  const response = await fetch(`/api/servers/${activeServer.id}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
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
}

serverTypeInput.addEventListener('change', updateFormFields);
createServerButton.addEventListener('click', createServer);
refreshStatusButton.addEventListener('click', loadStatus);
runQueryButton.addEventListener('click', runQuery);
loadTablesButton.addEventListener('click', loadTables);
deleteServerButton.addEventListener('click', deleteServer);

updateFormFields();
fetchServers();
