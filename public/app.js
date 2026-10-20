const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  environment: null,
  metadata: null,
  settings: null,
  selectedRouteId: null,
  selectedResponseId: null,
  activeTab: 'body',
  routeFilter: '',
  saveTimer: null,
  saving: false,
  dirty: false,
  logs: [],
  eventSource: null
};

const elements = {
  environmentName: $('#environment-name'),
  dataFileLabel: $('#data-file-label'),
  routeList: $('#route-list'),
  routeCount: $('#route-count'),
  routeSearch: $('#route-search'),
  routeEditor: $('#route-editor'),
  emptyState: $('#empty-state'),
  rawPanel: $('#raw-panel'),
  routeMethod: $('#route-method'),
  routeEndpoint: $('#route-endpoint'),
  routeDocumentation: $('#route-documentation'),
  endpointPrefix: $('#endpoint-prefix'),
  responseList: $('#response-list'),
  responseStatus: $('#response-status'),
  responseLabel: $('#response-label'),
  responseLatency: $('#response-latency'),
  responseDefault: $('#response-default'),
  responseBody: $('#response-body'),
  responseFilePath: $('#response-file-path'),
  responseBucketId: $('#response-bucket-id'),
  bodyLineNumbers: $('#body-line-numbers'),
  jsonStatus: $('#json-status'),
  headersTable: $('#headers-table'),
  rulesTable: $('#rules-table'),
  headersCount: $('#headers-count'),
  rulesCount: $('#rules-count'),
  rulesOperator: $('#rules-operator'),
  disableTemplating: $('#disable-templating'),
  fallback404: $('#fallback-404'),
  sendFileAsBody: $('#send-file-as-body'),
  saveState: $('#save-state'),
  runtimeStatus: $('#runtime-status'),
  runtimeStatusText: $('#runtime-status-text'),
  pushButton: $('#push-button'),
  rawEditor: $('#raw-json-editor'),
  settingsDialog: $('#settings-dialog'),
  historyDialog: $('#history-dialog'),
  logDrawer: $('#log-drawer'),
  logList: $('#log-list'),
  logCount: $('#log-count'),
  toastRegion: $('#toast-region')
};

function uuid() {
  return crypto.randomUUID();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || payload || `Request failed (${response.status})`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function currentRoute() {
  return state.environment?.routes?.find((route) => route.uuid === state.selectedRouteId) || null;
}

function currentResponse() {
  return currentRoute()?.responses?.find((response) => response.uuid === state.selectedResponseId) || null;
}

function methodClass(method) {
  return String(method || 'get').toLowerCase();
}

function displayPath(route) {
  const prefix = String(state.environment?.endpointPrefix || '').replace(/^\/+|\/+$/g, '');
  const endpoint = String(route.endpoint || '').replace(/^\/+/, '');
  return `/${[prefix, endpoint].filter(Boolean).join('/')}`;
}

function setSaveState(kind, label) {
  elements.saveState.className = `save-state ${kind || ''}`.trim();
  $('span', elements.saveState).textContent = label;
}

function toast(title, message = '', type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`.trim();
  item.innerHTML = `<b></b><span></span>`;
  $('b', item).textContent = title;
  $('span', item).textContent = message;
  elements.toastRegion.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function markDirty(reason = 'edit') {
  if (!state.environment) return;
  state.dirty = true;
  setSaveState('saving', 'Unsaved');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveEnvironment(reason), 700);
}

async function saveEnvironment(reason = 'autosave', push = false) {
  if (!state.environment || state.saving) return;
  clearTimeout(state.saveTimer);
  state.saving = true;
  setSaveState('saving', push ? 'Saving & pushing…' : 'Saving…');
  try {
    const result = await api('/api/environment', {
      method: 'PUT',
      body: JSON.stringify({ environment: state.environment, reason, push })
    });
    state.dirty = false;
    setSaveState('', result.live?.ok ? 'Saved · Live' : 'Saved');
    if (result.live && !result.live.ok) {
      toast('Saved locally, live push failed', result.live.error, 'error');
      await checkRuntime();
    }
    return result;
  } catch (error) {
    setSaveState('error', 'Save failed');
    toast('Could not save environment', formatApiError(error), 'error');
    throw error;
  } finally {
    state.saving = false;
  }
}

function formatApiError(error) {
  const errors = error.payload?.errors;
  return Array.isArray(errors) ? errors.join(' ') : error.message;
}

function renderShell() {
  const environment = state.environment;
  elements.environmentName.textContent = environment?.name || 'Untitled environment';
  elements.dataFileLabel.textContent = state.metadata?.dataFile || 'Local environment file';
  document.title = `${environment?.name || 'Mockoon'} · Live Studio`;
  elements.endpointPrefix.textContent = `/${String(environment?.endpointPrefix || '').replace(/^\/+|\/+$/g, '')}${environment?.endpointPrefix ? '/' : ''}`;
  renderRouteList();
  renderEditor();
}

function renderRouteList() {
  const routes = state.environment?.routes || [];
  const query = state.routeFilter.toLowerCase().trim();
  const visible = routes.filter((route) => {
    if (!query) return true;
    return `${route.method} ${displayPath(route)} ${route.documentation || ''}`.toLowerCase().includes(query);
  });
  elements.routeCount.textContent = routes.length;
  elements.routeList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'no-routes';
    empty.textContent = routes.length ? 'No routes match this filter.' : 'No routes yet. Add your first endpoint.';
    elements.routeList.append(empty);
    return;
  }
  visible.forEach((route) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `route-item ${route.uuid === state.selectedRouteId ? 'active' : ''}`;
    item.dataset.id = route.uuid;
    const method = methodClass(route.method);
    item.innerHTML = `<span class="method ${method}"></span><span><span class="route-path"></span><span class="route-description"></span></span>`;
    $('.method', item).textContent = method.toUpperCase();
    $('.route-path', item).textContent = displayPath(route);
    $('.route-description', item).textContent = route.documentation || `${route.responses?.length || 0} response${route.responses?.length === 1 ? '' : 's'}`;
    item.addEventListener('click', () => selectRoute(route.uuid));
    elements.routeList.append(item);
  });
}

function renderEditor() {
  const route = currentRoute();
  elements.rawPanel.classList.add('hidden');
  if (!route) {
    elements.routeEditor.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }
  elements.emptyState.classList.add('hidden');
  elements.routeEditor.classList.remove('hidden');
  elements.routeMethod.value = methodClass(route.method);
  elements.routeMethod.className = `method-select ${methodClass(route.method)}`;
  elements.routeEndpoint.value = route.endpoint || '';
  elements.routeDocumentation.value = route.documentation || '';
  if (!route.responses?.length) route.responses = [createResponse()];
  if (!route.responses.some((response) => response.uuid === state.selectedResponseId)) state.selectedResponseId = route.responses[0].uuid;
  renderResponseList();
  renderResponseEditor();
}

function renderResponseList() {
  const route = currentRoute();
  elements.responseList.replaceChildren();
  route.responses.forEach((response) => {
    const item = document.createElement('button');
    item.type = 'button';
    const code = Number(response.statusCode || 200);
    item.className = `response-item ${response.uuid === state.selectedResponseId ? 'active' : ''}`;
    item.innerHTML = `<span class="response-code ${code >= 400 ? 'error' : ''}"></span><span class="response-label"></span><span class="default-badge"></span>`;
    $('.response-code', item).textContent = code;
    $('.response-label', item).textContent = response.label || statusLabel(code);
    $('.default-badge', item).textContent = response.default ? '●' : '';
    item.addEventListener('click', () => {
      state.selectedResponseId = response.uuid;
      renderResponseList();
      renderResponseEditor();
    });
    elements.responseList.append(item);
  });
}

function renderResponseEditor() {
  const response = currentResponse();
  if (!response) return;
  response.headers ||= [];
  response.rules ||= [];
  elements.responseStatus.value = response.statusCode ?? 200;
  elements.responseLabel.value = response.label || '';
  elements.responseLatency.value = response.latency ?? 0;
  elements.responseDefault.checked = Boolean(response.default);
  elements.responseBody.value = response.body || '';
  elements.responseFilePath.value = response.filePath || '';
  elements.responseBucketId.value = response.databucketID || '';
  elements.rulesOperator.value = response.rulesOperator || 'OR';
  elements.disableTemplating.checked = Boolean(response.disableTemplating);
  elements.fallback404.checked = Boolean(response.fallbackTo404);
  elements.sendFileAsBody.checked = Boolean(response.sendFileAsBody);
  renderBodyType(response.bodyType || 'INLINE');
  updateLineNumbers();
  updateJsonStatus();
  renderHeaders();
  renderRules();
  switchTab(state.activeTab);
}

function statusLabel(code) {
  return ({ 200: 'OK', 201: 'Created', 204: 'No content', 400: 'Bad request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict', 422: 'Unprocessable', 500: 'Server error' })[code] || 'Response';
}

function renderBodyType(type) {
  $$('.segmented [data-body-type]').forEach((button) => button.classList.toggle('active', button.dataset.bodyType === type));
  $('#inline-body-editor').classList.toggle('hidden', type !== 'INLINE');
  $('#file-body-editor').classList.toggle('hidden', type !== 'FILE');
  $('#bucket-body-editor').classList.toggle('hidden', type !== 'DATABUCKET');
}

function renderHeaders() {
  const response = currentResponse();
  elements.headersCount.textContent = response.headers.length;
  elements.headersTable.replaceChildren();
  if (!response.headers.length) {
    elements.headersTable.innerHTML = '<div class="empty-table">No response headers. Add one when the client needs metadata or a content type.</div>';
    return;
  }
  response.headers.forEach((header, index) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = '<input aria-label="Header name" placeholder="Header name"><input aria-label="Header value" placeholder="Value"><button class="remove-row" type="button" aria-label="Remove header">×</button>';
    const inputs = $$('input', row);
    inputs[0].value = header.key || '';
    inputs[1].value = header.value || '';
    inputs[0].addEventListener('input', (event) => { header.key = event.target.value; markDirty('edit-header'); });
    inputs[1].addEventListener('input', (event) => { header.value = event.target.value; markDirty('edit-header'); });
    $('button', row).addEventListener('click', () => { response.headers.splice(index, 1); renderHeaders(); markDirty('delete-header'); });
    elements.headersTable.append(row);
  });
}

function renderRules() {
  const response = currentResponse();
  elements.rulesCount.textContent = response.rules.length;
  elements.rulesTable.replaceChildren();
  if (!response.rules.length) {
    elements.rulesTable.innerHTML = '<div class="empty-table">No rules. This response can be selected as the default response.</div>';
    return;
  }
  response.rules.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <select aria-label="Rule target">
        <option value="body">Body</option><option value="query">Query</option><option value="header">Header</option>
        <option value="cookie">Cookie</option><option value="params">Route param</option><option value="path">Path</option>
        <option value="method">Method</option><option value="request_number">Request number</option><option value="global_var">Global variable</option>
      </select>
      <input aria-label="Rule property" placeholder="Property / path">
      <select aria-label="Rule operator">
        <option value="equals">equals</option><option value="regex">matches regex</option><option value="contains">contains</option>
        <option value="startsWith">starts with</option><option value="endsWith">ends with</option><option value="null">is null</option>
      </select>
      <input aria-label="Rule value" placeholder="Expected value">
      <button class="remove-row" type="button" aria-label="Remove rule">×</button>`;
    const target = $('select:nth-of-type(1)', row);
    const property = $('input:nth-of-type(1)', row);
    const operator = $('select:nth-of-type(2)', row);
    const value = $('input:nth-of-type(2)', row);
    target.value = rule.target || 'body';
    property.value = rule.modifier || '';
    operator.value = rule.operator || 'equals';
    value.value = rule.value ?? '';
    target.addEventListener('change', (event) => { rule.target = event.target.value; markDirty('edit-rule'); });
    property.addEventListener('input', (event) => { rule.modifier = event.target.value; markDirty('edit-rule'); });
    operator.addEventListener('change', (event) => { rule.operator = event.target.value; markDirty('edit-rule'); });
    value.addEventListener('input', (event) => { rule.value = event.target.value; markDirty('edit-rule'); });
    $('button', row).addEventListener('click', () => { response.rules.splice(index, 1); renderRules(); markDirty('delete-rule'); });
    elements.rulesTable.append(row);
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
}

function selectRoute(routeId) {
  state.selectedRouteId = routeId;
  state.selectedResponseId = state.environment.routes.find((route) => route.uuid === routeId)?.responses?.[0]?.uuid || null;
  renderRouteList();
  renderEditor();
}

function createResponse() {
  return {
    uuid: uuid(), body: '{\n  "ok": true\n}', latency: 0, statusCode: 200, label: 'Success',
    headers: [{ key: 'Content-Type', value: 'application/json' }], bodyType: 'INLINE', filePath: '', databucketID: '',
    sendFileAsBody: false, rules: [], rulesOperator: 'OR', disableTemplating: false, fallbackTo404: false, default: true, crudKey: ''
  };
}

function addRoute() {
  const route = {
    uuid: uuid(), type: 'http', documentation: '', method: 'get', endpoint: 'new-route', responses: [createResponse()]
  };
  state.environment.routes.push(route);
  state.environment.rootChildren ||= [];
  state.environment.rootChildren.push({ type: 'route', uuid: route.uuid });
  state.routeFilter = '';
  elements.routeSearch.value = '';
  state.selectedRouteId = route.uuid;
  state.selectedResponseId = route.responses[0].uuid;
  renderShell();
  elements.routeEndpoint.focus();
  elements.routeEndpoint.select();
  markDirty('add-route');
}

function deleteRoute() {
  const route = currentRoute();
  if (!route || !confirm(`Delete ${String(route.method).toUpperCase()} ${displayPath(route)}?`)) return;
  const index = state.environment.routes.findIndex((item) => item.uuid === route.uuid);
  state.environment.routes.splice(index, 1);
  removeTreeReference(state.environment.rootChildren, route.uuid);
  const next = state.environment.routes[Math.min(index, state.environment.routes.length - 1)];
  state.selectedRouteId = next?.uuid || null;
  state.selectedResponseId = next?.responses?.[0]?.uuid || null;
  renderShell();
  markDirty('delete-route');
}

function removeTreeReference(children, routeId) {
  if (!Array.isArray(children)) return;
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (child?.type === 'route' && child.uuid === routeId) children.splice(index, 1);
    else removeTreeReference(child?.children, routeId);
  }
}

function addResponse() {
  const route = currentRoute();
  if (!route) return;
  const response = createResponse();
  if (route.responses.length) response.default = false;
  route.responses.push(response);
  state.selectedResponseId = response.uuid;
  renderResponseList();
  renderResponseEditor();
  markDirty('add-response');
}

function deleteResponse() {
  const route = currentRoute();
  const response = currentResponse();
  if (!route || !response) return;
  if (route.responses.length === 1) return toast('A route needs one response', 'Add another response before deleting this one.', 'error');
  const index = route.responses.findIndex((item) => item.uuid === response.uuid);
  route.responses.splice(index, 1);
  if (response.default && route.responses.length) route.responses[0].default = true;
  const next = route.responses[Math.min(index, route.responses.length - 1)];
  state.selectedResponseId = next.uuid;
  renderResponseList();
  renderResponseEditor();
  markDirty('delete-response');
}

function updateLineNumbers() {
  const lines = Math.max(1, elements.responseBody.value.split('\n').length);
  elements.bodyLineNumbers.textContent = Array.from({ length: lines }, (_, index) => index + 1).join('\n');
  elements.bodyLineNumbers.scrollTop = elements.responseBody.scrollTop;
}

function updateJsonStatus() {
  const body = elements.responseBody.value.trim();
  elements.jsonStatus.classList.remove('invalid');
  if (!body) return elements.jsonStatus.textContent = 'EMPTY';
  if (body.includes('{{')) return elements.jsonStatus.textContent = 'TEMPLATE';
  try {
    JSON.parse(body);
    elements.jsonStatus.textContent = 'VALID JSON';
  } catch {
    elements.jsonStatus.textContent = 'TEXT';
    elements.jsonStatus.classList.add('invalid');
  }
}

async function checkRuntime() {
  try {
    const result = await api('/api/runtime/status');
    elements.runtimeStatus.classList.toggle('connected', result.connected);
    elements.runtimeStatus.classList.toggle('disconnected', !result.connected);
    elements.runtimeStatusText.textContent = result.connected ? 'Runtime connected' : 'Runtime offline';
    elements.pushButton.disabled = !result.connected;
    if (result.connected) connectEventStream();
    else disconnectEventStream();
  } catch {
    elements.runtimeStatus.className = 'runtime-status disconnected';
    elements.runtimeStatusText.textContent = 'Runtime offline';
    elements.pushButton.disabled = true;
  }
}

async function pushLive() {
  elements.pushButton.disabled = true;
  elements.pushButton.querySelector('span:last-child').textContent = 'Pushing…';
  try {
    if (state.dirty) await saveEnvironment('manual-push');
    await api('/api/environment/push', { method: 'POST', body: JSON.stringify({ environment: state.environment }) });
    setSaveState('', 'Saved · Live');
    toast('Changes are live', 'The running Mockoon environment was updated.', 'success');
    await checkRuntime();
  } catch (error) {
    toast('Live push failed', formatApiError(error), 'error');
    await checkRuntime();
  } finally {
    elements.pushButton.querySelector('span:last-child').textContent = 'Push live';
    elements.pushButton.disabled = false;
  }
}

function connectEventStream() {
  if (state.eventSource) return;
  const source = new EventSource('/api/events');
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.event === 'transaction-complete' && payload.transaction) addLog(payload.transaction);
    } catch { /* Ignore malformed upstream events. */ }
  };
  source.onerror = () => {
    source.close();
    if (state.eventSource === source) state.eventSource = null;
  };
  state.eventSource = source;
}

function disconnectEventStream() {
  state.eventSource?.close();
  state.eventSource = null;
}

function addLog(transaction) {
  const request = transaction.request || {};
  const response = transaction.response || {};
  state.logs.unshift({
    id: uuid(), time: new Date(), method: request.method || 'GET', path: request.urlPath || request.path || '/',
    status: response.statusCode || transaction.statusCode || 0, duration: transaction.responseTime || transaction.duration || 0
  });
  state.logs = state.logs.slice(0, 150);
  renderLogs();
}

function renderLogs() {
  elements.logCount.textContent = `${state.logs.length} request${state.logs.length === 1 ? '' : 's'}`;
  elements.logList.replaceChildren();
  if (!state.logs.length) {
    elements.logList.innerHTML = '<div class="log-empty">Waiting for requests…</div>';
    return;
  }
  state.logs.forEach((log) => {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = '<span class="log-time"></span><span class="method"></span><span class="log-path"></span><span class="log-status"></span><span class="log-duration"></span>';
    $('.log-time', row).textContent = log.time.toLocaleTimeString([], { hour12: false });
    $('.method', row).textContent = String(log.method).toUpperCase();
    $('.method', row).classList.add(methodClass(log.method));
    $('.log-path', row).textContent = log.path;
    $('.log-status', row).textContent = log.status || '—';
    $('.log-status', row).style.color = log.status >= 400 ? 'var(--red)' : 'var(--green)';
    $('.log-duration', row).textContent = log.duration ? `${log.duration} ms` : '—';
    elements.logList.append(row);
  });
}

function openSettings() {
  $('#settings-name').value = state.environment.name || '';
  $('#settings-hostname').value = state.environment.hostname || '';
  $('#settings-port').value = state.environment.port || 3000;
  $('#settings-prefix').value = state.environment.endpointPrefix || '';
  $('#settings-latency').value = state.environment.latency || 0;
  $('#settings-admin-url').value = state.settings.adminUrl || '';
  $('#settings-admin-token').value = state.settings.hasAdminToken ? '••••••••' : '';
  $('#settings-auto-push').checked = Boolean(state.settings.autoPush);
  elements.settingsDialog.showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  state.environment.name = $('#settings-name').value.trim() || 'Untitled environment';
  state.environment.hostname = $('#settings-hostname').value.trim();
  state.environment.port = Number($('#settings-port').value) || 3000;
  state.environment.endpointPrefix = $('#settings-prefix').value.trim().replace(/^\/+|\/+$/g, '');
  state.environment.latency = Number($('#settings-latency').value) || 0;
  try {
    const result = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        adminUrl: $('#settings-admin-url').value.trim(),
        adminToken: $('#settings-admin-token').value,
        autoPush: $('#settings-auto-push').checked
      })
    });
    state.settings = { ...state.settings, ...result.settings };
    elements.settingsDialog.close();
    renderShell();
    await saveEnvironment('settings');
    await checkRuntime();
    toast('Settings saved', state.settings.autoPush ? 'Autosave will also push changes live.' : 'Environment settings were updated.', 'success');
  } catch (error) {
    toast('Could not save settings', formatApiError(error), 'error');
  }
}

async function openHistory() {
  const list = $('#history-list');
  list.innerHTML = '<div class="loading-row">Loading history…</div>';
  elements.historyDialog.showModal();
  try {
    const result = await api('/api/history');
    list.replaceChildren();
    if (!result.history.length) {
      list.innerHTML = '<div class="loading-row">History will appear after the first saved change.</div>';
      return;
    }
    result.history.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = '<span><b></b><small></small></span><button class="button subtle" type="button">Restore</button>';
      $('b', row).textContent = new Date(entry.createdAt).toLocaleString();
      $('small', row).textContent = `${entry.reason} · ${Math.max(1, Math.round(entry.size / 1024))} KB`;
      $('button', row).addEventListener('click', () => restoreHistory(entry.id));
      list.append(row);
    });
  } catch (error) {
    list.innerHTML = `<div class="loading-row">${error.message}</div>`;
  }
}

async function restoreHistory(id) {
  if (!confirm('Restore this version? The current file will be preserved in history.')) return;
  try {
    const result = await api(`/api/history/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    state.environment = result.environment;
    state.selectedRouteId = state.environment.routes?.[0]?.uuid || null;
    state.selectedResponseId = state.environment.routes?.[0]?.responses?.[0]?.uuid || null;
    elements.historyDialog.close();
    renderShell();
    toast('Version restored', 'The previous current version is still available in history.', 'success');
  } catch (error) {
    toast('Restore failed', formatApiError(error), 'error');
  }
}

function exportEnvironment() {
  const blob = new Blob([`${JSON.stringify(state.environment, null, 2)}\n`], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${String(state.environment.name || 'mockoon-environment').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importEnvironment(file) {
  if (!file) return;
  try {
    const environment = JSON.parse(await file.text());
    if (!environment.uuid || !Array.isArray(environment.routes)) throw new Error('This does not look like a Mockoon environment file.');
    state.environment = environment;
    state.selectedRouteId = environment.routes[0]?.uuid || null;
    state.selectedResponseId = environment.routes[0]?.responses?.[0]?.uuid || null;
    renderShell();
    await saveEnvironment('import');
    toast('Environment imported', `${environment.routes.length} routes loaded.`, 'success');
  } catch (error) {
    toast('Import failed', error.message, 'error');
  } finally {
    $('#file-input').value = '';
  }
}

function openRawEditor() {
  clearTimeout(state.saveTimer);
  elements.routeEditor.classList.add('hidden');
  elements.emptyState.classList.add('hidden');
  elements.rawPanel.classList.remove('hidden');
  elements.rawEditor.value = JSON.stringify(state.environment, null, 2);
}

function applyRawJson() {
  try {
    const environment = JSON.parse(elements.rawEditor.value);
    if (!environment.uuid || !environment.name || !Array.isArray(environment.routes)) throw new Error('Environment requires uuid, name, and routes fields.');
    state.environment = environment;
    const selected = environment.routes.find((route) => route.uuid === state.selectedRouteId) || environment.routes[0];
    state.selectedRouteId = selected?.uuid || null;
    state.selectedResponseId = selected?.responses?.[0]?.uuid || null;
    renderShell();
    markDirty('raw-json');
    toast('Raw JSON applied', 'The environment will be saved automatically.', 'success');
  } catch (error) {
    toast('Invalid environment JSON', error.message, 'error');
  }
}

function bindInput(element, property, transform = (value) => value, after) {
  element.addEventListener('input', (event) => {
    const target = currentResponse();
    if (!target) return;
    target[property] = transform(event.target.type === 'checkbox' ? event.target.checked : event.target.value);
    after?.(target);
    markDirty(`edit-${property}`);
  });
}

function bindEvents() {
  $('#add-route-button').addEventListener('click', addRoute);
  $('#empty-add-route').addEventListener('click', addRoute);
  $('#delete-route-button').addEventListener('click', deleteRoute);
  $('#add-response-button').addEventListener('click', addResponse);
  $('#delete-response-button').addEventListener('click', deleteResponse);
  elements.routeSearch.addEventListener('input', (event) => { state.routeFilter = event.target.value; renderRouteList(); });

  elements.routeMethod.addEventListener('change', (event) => {
    const route = currentRoute(); if (!route) return;
    route.method = event.target.value;
    elements.routeMethod.className = `method-select ${methodClass(route.method)}`;
    renderRouteList(); markDirty('edit-route');
  });
  elements.routeEndpoint.addEventListener('input', (event) => { const route = currentRoute(); if (!route) return; route.endpoint = event.target.value.replace(/^\/+/, ''); renderRouteList(); markDirty('edit-route'); });
  elements.routeDocumentation.addEventListener('input', (event) => { const route = currentRoute(); if (!route) return; route.documentation = event.target.value; renderRouteList(); markDirty('edit-route'); });

  bindInput(elements.responseStatus, 'statusCode', Number, () => renderResponseList());
  bindInput(elements.responseLabel, 'label', String, () => renderResponseList());
  bindInput(elements.responseLatency, 'latency', Number);
  bindInput(elements.responseBody, 'body', String, () => { updateLineNumbers(); updateJsonStatus(); });
  bindInput(elements.responseFilePath, 'filePath');
  bindInput(elements.responseBucketId, 'databucketID');
  bindInput(elements.disableTemplating, 'disableTemplating', Boolean);
  bindInput(elements.fallback404, 'fallbackTo404', Boolean);
  bindInput(elements.sendFileAsBody, 'sendFileAsBody', Boolean);

  elements.responseDefault.addEventListener('change', (event) => {
    const route = currentRoute(); const response = currentResponse(); if (!route || !response) return;
    route.responses.forEach((item) => { item.default = item.uuid === response.uuid ? event.target.checked : false; });
    if (!route.responses.some((item) => item.default)) response.default = true;
    elements.responseDefault.checked = response.default;
    renderResponseList(); markDirty('set-default-response');
  });
  elements.rulesOperator.addEventListener('change', (event) => { currentResponse().rulesOperator = event.target.value; markDirty('rules-operator'); });

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  $$('.segmented [data-body-type]').forEach((button) => button.addEventListener('click', () => {
    currentResponse().bodyType = button.dataset.bodyType;
    renderBodyType(button.dataset.bodyType); markDirty('body-type');
  }));

  $('#add-header-button').addEventListener('click', () => { currentResponse().headers.push({ key: '', value: '' }); renderHeaders(); markDirty('add-header'); });
  $('#add-rule-button').addEventListener('click', () => { currentResponse().rules.push({ target: 'body', modifier: '', operator: 'equals', value: '', invert: false }); renderRules(); markDirty('add-rule'); });
  $('#format-json-button').addEventListener('click', () => {
    try {
      const formatted = JSON.stringify(JSON.parse(elements.responseBody.value), null, 2);
      elements.responseBody.value = formatted;
      currentResponse().body = formatted;
      updateLineNumbers(); updateJsonStatus(); markDirty('format-json');
    } catch { toast('Cannot format this body', 'It may contain templates or plain text.', 'error'); }
  });
  $('#copy-body-button').addEventListener('click', async () => { await navigator.clipboard.writeText(elements.responseBody.value); toast('Copied response body', '', 'success'); });
  elements.responseBody.addEventListener('scroll', () => { elements.bodyLineNumbers.scrollTop = elements.responseBody.scrollTop; });
  elements.responseBody.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = event.target.selectionStart; const end = event.target.selectionEnd;
    event.target.value = `${event.target.value.slice(0, start)}  ${event.target.value.slice(end)}`;
    event.target.selectionStart = event.target.selectionEnd = start + 2;
    event.target.dispatchEvent(new Event('input'));
  });

  elements.pushButton.addEventListener('click', pushLive);
  $('#settings-button').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#history-button').addEventListener('click', openHistory);
  $('#history-close').addEventListener('click', () => elements.historyDialog.close());
  $('#import-button').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (event) => importEnvironment(event.target.files[0]));
  $('#export-button').addEventListener('click', exportEnvironment);
  $('#raw-editor-button').addEventListener('click', openRawEditor);
  $('#raw-cancel-button').addEventListener('click', renderEditor);
  $('#raw-apply-button').addEventListener('click', applyRawJson);
  $('#log-toggle').addEventListener('click', () => elements.logDrawer.classList.toggle('collapsed'));
  $('#clear-logs-button').addEventListener('click', () => { state.logs = []; renderLogs(); });
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveEnvironment('keyboard-save'); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); elements.routeSearch.focus(); }
  });
}

async function bootstrap() {
  bindEvents();
  try {
    const [environmentResult, settingsResult] = await Promise.all([api('/api/environment'), api('/api/settings')]);
    state.environment = environmentResult.environment;
    state.metadata = environmentResult.metadata;
    state.settings = settingsResult.settings;
    const firstRoute = state.environment.routes?.[0];
    state.selectedRouteId = firstRoute?.uuid || null;
    state.selectedResponseId = firstRoute?.responses?.[0]?.uuid || null;
    renderShell();
    renderLogs();
    await checkRuntime();
    setInterval(checkRuntime, 15000);
  } catch (error) {
    elements.workspace.innerHTML = `<section class="empty-state"><div><h2>Could not open environment</h2><p>${error.message}</p></div></section>`;
    toast('Startup failed', formatApiError(error), 'error');
  }
}

bootstrap();
