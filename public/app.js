import {
  FAKER_SNIPPETS,
  HTTP_METHODS,
  RESPONSE_MODES,
  RULE_OPERATORS,
  RULE_TARGETS,
  buildCallback,
  buildDataBucket,
  buildFolder,
  buildRule,
  buildResponse,
  buildRoute,
  newUuid,
  normalizeEnvironment,
  validateEnvironmentSchema
} from './mockoon-schema.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  environment: null,
  metadata: null,
  settings: null,
  selectedRouteId: null,
  selectedResponseId: null,
  activeTab: 'body',
  activeFeature: null,
  selectedFeatureId: null,
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
  routeType: $('#route-type'),
  routeEndpoint: $('#route-endpoint'),
  routeDocumentation: $('#route-documentation'),
  endpointPrefix: $('#endpoint-prefix'),
  responseList: $('#response-list'),
  routeResponseMode: $('#route-response-mode'),
  routeFolder: $('#route-folder'),
  routeStreamingMode: $('#route-streaming-mode'),
  routeStreamingInterval: $('#route-streaming-interval'),
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
  callbacksCount: $('#callbacks-count'),
  rulesOperator: $('#rules-operator'),
  disableTemplating: $('#disable-templating'),
  fallback404: $('#fallback-404'),
  sendFileAsBody: $('#send-file-as-body'),
  responseCrudKey: $('#response-crud-key'),
  saveState: $('#save-state'),
  runtimeStatus: $('#runtime-status'),
  runtimeStatusText: $('#runtime-status-text'),
  pushButton: $('#push-button'),
  rawEditor: $('#raw-json-editor'),
  featurePanel: $('#feature-panel'),
  featureTitle: $('#feature-title'),
  featureDescription: $('#feature-description'),
  featureList: $('#feature-list'),
  featureEditor: $('#feature-editor'),
  settingsDialog: $('#settings-dialog'),
  historyDialog: $('#history-dialog'),
  logDrawer: $('#log-drawer'),
  logList: $('#log-list'),
  logCount: $('#log-count'),
  toastRegion: $('#toast-region')
};

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
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
  const appendRoute = (route, container = elements.routeList) => {
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
    container.append(item);
  };

  if (query) {
    visible.forEach((route) => appendRoute(route));
    return;
  }

  const rendered = new Set();
  const renderChildren = (children, container) => {
    (children || []).forEach((child) => {
      if (child.type === 'route') {
        const route = routes.find((item) => item.uuid === child.uuid);
        if (route) { appendRoute(route, container); rendered.add(route.uuid); }
        return;
      }
      const folder = state.environment.folders.find((item) => item.uuid === child.uuid);
      if (!folder) return;
      const block = document.createElement('div');
      block.className = 'folder-block';
      const heading = document.createElement('div');
      heading.className = 'folder-heading';
      heading.innerHTML = '<span></span><span class="folder-actions"><button type="button" title="Add subfolder">＋</button><button type="button" title="Rename folder">✎</button><button type="button" title="Delete folder">×</button></span>';
      $('span:first-child', heading).textContent = folder.name;
      const nested = document.createElement('div');
      nested.className = 'folder-routes';
      $$('.folder-actions button', heading)[0].addEventListener('click', () => addFolder(folder));
      $$('.folder-actions button', heading)[1].addEventListener('click', () => renameFolder(folder));
      $$('.folder-actions button', heading)[2].addEventListener('click', () => deleteFolder(folder));
      block.append(heading, nested);
      container.append(block);
      renderChildren(folder.children, nested);
    });
  };
  renderChildren(state.environment.rootChildren, elements.routeList);
  routes.filter((route) => !rendered.has(route.uuid)).forEach((route) => appendRoute(route));
}

function renderEditor() {
  const route = currentRoute();
  elements.rawPanel.classList.add('hidden');
  elements.featurePanel.classList.add('hidden');
  $$('.environment-nav button').forEach((button) => button.classList.remove('active'));
  if (!route) {
    elements.routeEditor.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }
  elements.emptyState.classList.add('hidden');
  elements.routeEditor.classList.remove('hidden');
  elements.routeType.value = route.type || 'http';
  elements.routeMethod.value = methodClass(route.method);
  elements.routeMethod.className = `method-select ${methodClass(route.method)}`;
  elements.routeMethod.classList.toggle('hidden', route.type === 'crud');
  elements.routeEndpoint.value = route.endpoint || '';
  elements.routeDocumentation.value = route.documentation || '';
  elements.routeResponseMode.value = route.responseMode || '';
  elements.routeStreamingMode.value = route.streamingMode || '';
  elements.routeStreamingInterval.value = route.streamingInterval || 0;
  $('#streaming-mode-field').classList.toggle('hidden', route.type !== 'ws');
  $('#streaming-interval-field').classList.toggle('hidden', route.type !== 'ws' || !route.streamingMode);
  renderFolderSelect(route.uuid);
  if (!route.responses?.length) route.responses = [buildResponse()];
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
  response.callbacks ||= [];
  elements.responseStatus.value = response.statusCode ?? 200;
  elements.responseLabel.value = response.label || '';
  elements.responseLatency.value = response.latency ?? 0;
  elements.responseDefault.checked = Boolean(response.default);
  elements.responseDefault.disabled = currentRoute()?.type === 'crud' && currentRoute()?.responses?.[0]?.uuid === response.uuid;
  elements.responseBody.value = response.body || '';
  elements.responseFilePath.value = response.filePath || '';
  elements.responseBucketId.innerHTML = '<option value="">Select data bucket…</option>' + state.environment.data.map((bucket) => `<option value="${bucket.uuid}">${escapeHtml(bucket.name)}</option>`).join('');
  elements.responseBucketId.value = response.databucketID || '';
  elements.rulesOperator.value = response.rulesOperator || 'OR';
  elements.disableTemplating.checked = Boolean(response.disableTemplating);
  elements.fallback404.checked = Boolean(response.fallbackTo404);
  elements.sendFileAsBody.checked = Boolean(response.sendFileAsBody);
  elements.responseCrudKey.value = response.crudKey || 'id';
  $('#crud-key-field').classList.toggle('hidden', currentRoute()?.type !== 'crud');
  renderBodyType(response.bodyType || 'INLINE');
  updateLineNumbers();
  updateJsonStatus();
  renderHeaders();
  renderRules();
  renderResponseCallbacks();
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
      <select aria-label="Rule target"></select>
      <input aria-label="Rule property" placeholder="Property / path">
      <button class="invert-rule" type="button" title="Invert condition">!</button>
      <select aria-label="Rule operator"></select>
      <input aria-label="Rule value" placeholder="Expected value">
      <span class="row-actions"><button class="move-row" type="button" title="Move up">↑</button><button class="move-row" type="button" title="Move down">↓</button><button class="remove-row" type="button" aria-label="Remove rule">×</button></span>`;
    const target = $('select:nth-of-type(1)', row);
    const property = $('input:nth-of-type(1)', row);
    const operator = $('select:nth-of-type(2)', row);
    const value = $('input:nth-of-type(2)', row);
    target.innerHTML = RULE_TARGETS.map((item) => `<option value="${item.value}">${item.label}</option>`).join('');
    operator.innerHTML = RULE_OPERATORS.map((item) => `<option value="${item.value}">${item.label}</option>`).join('');
    target.value = rule.target || 'body';
    property.value = rule.modifier || '';
    operator.value = rule.operator || 'equals';
    value.value = rule.value ?? '';
    const invert = $('.invert-rule', row);
    const refreshRuleFields = () => {
      const targetInfo = RULE_TARGETS.find((item) => item.value === rule.target);
      const operatorInfo = RULE_OPERATORS.find((item) => item.value === rule.operator);
      property.disabled = targetInfo?.modifier === false;
      value.disabled = Boolean(operatorInfo?.noValue);
      invert.classList.toggle('active', Boolean(rule.invert));
    };
    target.addEventListener('change', (event) => { rule.target = event.target.value; refreshRuleFields(); markDirty('edit-rule'); });
    property.addEventListener('input', (event) => { rule.modifier = event.target.value; markDirty('edit-rule'); });
    invert.addEventListener('click', () => { rule.invert = !rule.invert; refreshRuleFields(); markDirty('invert-rule'); });
    operator.addEventListener('change', (event) => { rule.operator = event.target.value; refreshRuleFields(); markDirty('edit-rule'); });
    value.addEventListener('input', (event) => { rule.value = event.target.value; markDirty('edit-rule'); });
    const actions = $$('.row-actions button', row);
    actions[0].disabled = index === 0;
    actions[1].disabled = index === response.rules.length - 1;
    actions[0].addEventListener('click', () => moveArrayItem(response.rules, index, index - 1, renderRules, 'reorder-rule'));
    actions[1].addEventListener('click', () => moveArrayItem(response.rules, index, index + 1, renderRules, 'reorder-rule'));
    actions[2].addEventListener('click', () => { response.rules.splice(index, 1); renderRules(); markDirty('delete-rule'); });
    refreshRuleFields();
    elements.rulesTable.append(row);
  });
}

function moveArrayItem(items, from, to, render, reason) {
  if (to < 0 || to >= items.length) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  render();
  markDirty(reason);
}

function renderResponseCallbacks() {
  const response = currentResponse();
  elements.callbacksCount.textContent = response.callbacks.length;
  const table = $('#response-callbacks-table');
  table.replaceChildren();
  if (!state.environment.callbacks.length) {
    table.innerHTML = '<div class="empty-table">No reusable callbacks exist. Create one from Environment → Callbacks.</div>';
    return;
  }
  if (!response.callbacks.length) {
    table.innerHTML = '<div class="empty-table">No callback is invoked by this response.</div>';
    return;
  }
  response.callbacks.forEach((invocation, index) => {
    const row = document.createElement('div');
    row.className = 'callback-invocation-row';
    row.innerHTML = '<select aria-label="Callback"></select><div class="input-suffix"><input type="number" min="0" aria-label="Callback latency"><span>ms</span></div><button class="remove-row" type="button">×</button>';
    const select = $('select', row);
    select.innerHTML = state.environment.callbacks.map((callback) => `<option value="${callback.uuid}">${escapeHtml(callback.name)}</option>`).join('');
    select.value = invocation.uuid;
    $('input', row).value = invocation.latency || 0;
    select.addEventListener('change', (event) => { invocation.uuid = event.target.value; markDirty('edit-response-callback'); });
    $('input', row).addEventListener('input', (event) => { invocation.latency = Number(event.target.value) || 0; markDirty('edit-response-callback'); });
    $('button', row).addEventListener('click', () => { response.callbacks.splice(index, 1); renderResponseCallbacks(); markDirty('delete-response-callback'); });
    table.append(row);
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

function addRoute(type = 'http') {
  const route = buildRoute(type);
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
  if (Array.isArray(children)) {
    for (let index = children.length - 1; index >= 0; index--) {
      if (children[index]?.type === 'route' && children[index].uuid === routeId) children.splice(index, 1);
    }
  }
  state.environment.folders.forEach((folder) => {
    for (let index = folder.children.length - 1; index >= 0; index--) {
      if (folder.children[index]?.type === 'route' && folder.children[index].uuid === routeId) folder.children.splice(index, 1);
    }
  });
}

function addFolder(parentFolder = null) {
  const folder = buildFolder();
  const name = prompt('Folder name', folder.name);
  if (name === null) return;
  folder.name = name.trim() || folder.name;
  state.environment.folders.push(folder);
  (parentFolder?.children || state.environment.rootChildren).push({ type: 'folder', uuid: folder.uuid });
  renderRouteList();
  markDirty('add-folder');
}

function renameFolder(folder) {
  const name = prompt('Folder name', folder.name);
  if (name === null) return;
  folder.name = name.trim() || folder.name;
  renderRouteList();
  renderFolderSelect(currentRoute()?.uuid);
  markDirty('rename-folder');
}

function deleteFolder(folder) {
  if (!confirm(`Delete folder “${folder.name}”? Its contents will move to the parent folder.`)) return;
  const children = [...folder.children];
  const parentChildren = findFolderParentChildren(folder.uuid);
  const position = parentChildren.findIndex((child) => child.type === 'folder' && child.uuid === folder.uuid);
  if (position >= 0) parentChildren.splice(position, 1, ...children);
  state.environment.folders = state.environment.folders.filter((item) => item.uuid !== folder.uuid);
  renderRouteList();
  renderFolderSelect(currentRoute()?.uuid);
  markDirty('delete-folder');
}

function findFolderParentChildren(folderId) {
  if (state.environment.rootChildren.some((child) => child.type === 'folder' && child.uuid === folderId)) return state.environment.rootChildren;
  return state.environment.folders.find((folder) => folder.children.some((child) => child.type === 'folder' && child.uuid === folderId))?.children || state.environment.rootChildren;
}

function findRouteFolder(routeId) {
  return state.environment.folders.find((folder) => folder.children.some((child) => child.type === 'route' && child.uuid === routeId))?.uuid || '';
}

function renderFolderSelect(routeId) {
  elements.routeFolder.innerHTML = '<option value="">Root</option>' + state.environment.folders.map((folder) => `<option value="${folder.uuid}">${escapeHtml(folder.name)}</option>`).join('');
  elements.routeFolder.value = findRouteFolder(routeId);
}

function moveRouteToFolder(routeId, folderId) {
  removeTreeReference(state.environment.rootChildren, routeId);
  const destination = folderId ? state.environment.folders.find((folder) => folder.uuid === folderId)?.children : state.environment.rootChildren;
  destination?.push({ type: 'route', uuid: routeId });
  renderRouteList();
  markDirty('move-route');
}

function addResponse() {
  const route = currentRoute();
  if (!route) return;
  const response = buildResponse({ isDefault: route.responses.length === 0 });
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
  if (route.type === 'crud' && route.responses[0]?.uuid === response.uuid) return toast('CRUD operations response is required', 'The first CRUD response cannot be deleted.', 'error');
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
    id: newUuid(), time: new Date(), method: request.method || 'GET', path: request.urlPath || request.path || '/',
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

const featureMeta = {
  databuckets: { title: 'Data buckets', description: 'Reusable data, templates, JSON schemas, and CRUD route storage.', add: 'Add data bucket' },
  callbacks: { title: 'Callbacks', description: 'Reusable outbound HTTP calls invoked after route responses.', add: 'Add callback' },
  headers: { title: 'Environment headers', description: 'Default response headers inherited by every route.', add: 'Add header' },
  proxy: { title: 'Proxy, TLS & server', description: 'Complete environment-level configuration.', add: '' }
};

function openFeature(feature) {
  state.activeFeature = feature;
  state.selectedFeatureId = feature === 'databuckets'
    ? state.environment.data[0]?.uuid || null
    : feature === 'callbacks'
      ? state.environment.callbacks[0]?.uuid || null
      : null;
  elements.routeEditor.classList.add('hidden');
  elements.emptyState.classList.add('hidden');
  elements.rawPanel.classList.add('hidden');
  elements.featurePanel.classList.remove('hidden');
  $$('.environment-nav button').forEach((button) => button.classList.toggle('active', button.dataset.feature === feature));
  renderFeature();
}

function renderFeature() {
  const meta = featureMeta[state.activeFeature];
  elements.featureTitle.textContent = meta.title;
  elements.featureDescription.textContent = meta.description;
  $('#feature-add-button').textContent = meta.add || 'Add';
  $('#feature-add-button').classList.toggle('hidden', !meta.add);
  elements.featureList.replaceChildren();
  if (state.activeFeature === 'databuckets') return renderDataBucketFeature();
  if (state.activeFeature === 'callbacks') return renderCallbackFeature();
  if (state.activeFeature === 'headers') return renderEnvironmentHeadersFeature();
  if (state.activeFeature === 'proxy') return renderProxyFeature();
}

function appendFeatureListItem(id, title, subtitle, onSelect) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `feature-list-item ${state.selectedFeatureId === id ? 'active' : ''}`;
  button.innerHTML = '<b></b><small></small>';
  $('b', button).textContent = title;
  $('small', button).textContent = subtitle;
  button.addEventListener('click', () => { state.selectedFeatureId = id; onSelect(); });
  elements.featureList.append(button);
}

function renderDataBucketFeature() {
  state.environment.data.forEach((bucket) => appendFeatureListItem(bucket.uuid, bucket.name, `ID: ${bucket.id}`, renderFeature));
  const bucket = state.environment.data.find((item) => item.uuid === state.selectedFeatureId);
  if (!bucket) {
    elements.featureEditor.innerHTML = '<div class="feature-empty">No data bucket selected.<br>Create one to share data across routes or validate JSON schemas.</div>';
    return;
  }
  elements.featureEditor.innerHTML = `
    <div class="feature-form">
      <div class="feature-form-grid">
        <label class="field"><span>Name</span><input id="bucket-name"></label>
        <label class="field"><span>Unique ID</span><input id="bucket-id"></label>
        <label class="field span-all"><span>Documentation</span><input id="bucket-documentation"></label>
      </div>
      <label class="field"><span>Value / template</span><textarea id="bucket-value" class="feature-code" spellcheck="false"></textarea></label>
      <div class="feature-actions"><button class="button danger-ghost" id="delete-bucket" type="button">Delete data bucket</button></div>
    </div>`;
  $('#bucket-name').value = bucket.name;
  $('#bucket-id').value = bucket.id;
  $('#bucket-documentation').value = bucket.documentation;
  $('#bucket-value').value = bucket.value;
  bindObjectInput('#bucket-name', bucket, 'name');
  bindObjectInput('#bucket-id', bucket, 'id');
  bindObjectInput('#bucket-documentation', bucket, 'documentation');
  bindObjectInput('#bucket-value', bucket, 'value');
  $('#delete-bucket').addEventListener('click', () => deleteDataBucket(bucket));
}

function deleteDataBucket(bucket) {
  if (!confirm(`Delete data bucket “${bucket.name}”?`)) return;
  state.environment.data = state.environment.data.filter((item) => item.uuid !== bucket.uuid);
  state.environment.routes.forEach((route) => route.responses.forEach((response) => { if (response.databucketID === bucket.uuid) response.databucketID = ''; }));
  state.environment.callbacks.forEach((callback) => { if (callback.databucketID === bucket.uuid) callback.databucketID = ''; });
  state.selectedFeatureId = state.environment.data[0]?.uuid || null;
  renderFeature();
  markDirty('delete-databucket');
}

function renderCallbackFeature() {
  state.environment.callbacks.forEach((callback) => appendFeatureListItem(callback.uuid, callback.name, `${String(callback.method).toUpperCase()} ${callback.uri}`, renderFeature));
  const callback = state.environment.callbacks.find((item) => item.uuid === state.selectedFeatureId);
  if (!callback) {
    elements.featureEditor.innerHTML = '<div class="feature-empty">No callback selected.<br>Create a reusable callback and attach it to any response.</div>';
    return;
  }
  const bucketOptions = '<option value="">Select data bucket…</option>' + state.environment.data.map((bucket) => `<option value="${bucket.uuid}">${escapeHtml(bucket.name)}</option>`).join('');
  elements.featureEditor.innerHTML = `
    <div class="feature-form">
      <div class="feature-form-grid">
        <label class="field"><span>Name</span><input id="callback-name"></label>
        <label class="field"><span>Unique ID</span><input id="callback-id"></label>
        <label class="field span-all"><span>Documentation</span><input id="callback-documentation"></label>
        <label class="field"><span>Method</span><select id="callback-method" class="small-select">${HTTP_METHODS.filter((method) => method !== 'all').map((method) => `<option value="${method}">${method.toUpperCase()}</option>`).join('')}</select></label>
        <label class="field"><span>URL</span><input id="callback-uri" placeholder="/path or https://example.com/path"></label>
        <label class="field"><span>Body type</span><select id="callback-body-type" class="small-select"><option value="INLINE">Inline</option><option value="FILE">File</option><option value="DATABUCKET">Data bucket</option></select></label>
        <label class="field callback-file-field"><span>File path</span><input id="callback-file-path"></label>
        <label class="field callback-bucket-field"><span>Data bucket</span><select id="callback-bucket" class="small-select">${bucketOptions}</select></label>
        <label class="check-card callback-file-field"><input id="callback-send-file" type="checkbox"><span><b>Send file as body</b><small>Read the file and use its contents as the request body.</small></span></label>
      </div>
      <label class="field callback-inline-field"><span>Request body</span><textarea id="callback-body" class="feature-code" spellcheck="false"></textarea></label>
      <div class="feature-section"><div class="feature-kv-title"><b>Request headers</b><button class="mini-button" id="add-callback-header" type="button">＋ Add header</button></div><div class="kv-table" id="callback-headers"></div></div>
      <div class="feature-actions"><button class="button danger-ghost" id="delete-callback" type="button">Delete callback</button></div>
    </div>`;
  $('#callback-name').value = callback.name;
  $('#callback-id').value = callback.id;
  $('#callback-documentation').value = callback.documentation;
  $('#callback-method').value = callback.method;
  $('#callback-uri').value = callback.uri;
  $('#callback-body-type').value = callback.bodyType;
  $('#callback-body').value = callback.body || '';
  $('#callback-file-path').value = callback.filePath || '';
  $('#callback-bucket').value = callback.databucketID || '';
  $('#callback-send-file').checked = Boolean(callback.sendFileAsBody);
  const refreshBodyType = () => {
    $$('.callback-inline-field').forEach((element) => element.classList.toggle('hidden', callback.bodyType !== 'INLINE'));
    $$('.callback-file-field').forEach((element) => element.classList.toggle('hidden', callback.bodyType !== 'FILE'));
    $$('.callback-bucket-field').forEach((element) => element.classList.toggle('hidden', callback.bodyType !== 'DATABUCKET'));
  };
  bindObjectInput('#callback-name', callback, 'name');
  bindObjectInput('#callback-id', callback, 'id');
  bindObjectInput('#callback-documentation', callback, 'documentation');
  bindObjectInput('#callback-method', callback, 'method', String, () => renderFeature(), 'change');
  bindObjectInput('#callback-uri', callback, 'uri');
  bindObjectInput('#callback-body-type', callback, 'bodyType', String, refreshBodyType, 'change');
  bindObjectInput('#callback-body', callback, 'body');
  bindObjectInput('#callback-file-path', callback, 'filePath');
  bindObjectInput('#callback-bucket', callback, 'databucketID', String, null, 'change');
  bindObjectInput('#callback-send-file', callback, 'sendFileAsBody', Boolean, null, 'change');
  renderKeyValueEditor(callback.headers, $('#callback-headers'), 'callback-header');
  $('#add-callback-header').addEventListener('click', () => { callback.headers.push({ key: '', value: '' }); renderFeature(); markDirty('add-callback-header'); });
  $('#delete-callback').addEventListener('click', () => deleteCallback(callback));
  refreshBodyType();
}

function deleteCallback(callback) {
  if (!confirm(`Delete callback “${callback.name}”?`)) return;
  state.environment.callbacks = state.environment.callbacks.filter((item) => item.uuid !== callback.uuid);
  state.environment.routes.forEach((route) => route.responses.forEach((response) => { response.callbacks = response.callbacks.filter((item) => item.uuid !== callback.uuid); }));
  state.selectedFeatureId = state.environment.callbacks[0]?.uuid || null;
  renderFeature();
  markDirty('delete-callback');
}

function renderEnvironmentHeadersFeature() {
  elements.featureList.innerHTML = '<button class="feature-list-item active" type="button"><b>Response headers</b><small>Inherited by all routes</small></button>';
  elements.featureEditor.innerHTML = '<div class="feature-form"><div class="feature-kv-title"><b>Environment response headers</b><button class="mini-button" id="add-environment-header" type="button">＋ Add header</button></div><div class="kv-table" id="environment-headers"></div></div>';
  renderKeyValueEditor(state.environment.headers, $('#environment-headers'), 'environment-header');
  $('#add-environment-header').addEventListener('click', () => { state.environment.headers.push({ key: '', value: '' }); renderFeature(); markDirty('add-environment-header'); });
}

function renderProxyFeature() {
  const environment = state.environment;
  elements.featureList.innerHTML = '<button class="feature-list-item active" type="button"><b>Environment</b><small>Server, proxy and TLS</small></button>';
  elements.featureEditor.innerHTML = `
    <div class="feature-form">
      <div class="feature-form-grid">
        <label class="field"><span>Name</span><input id="env-name"></label>
        <label class="field"><span>Endpoint prefix</span><input id="env-prefix"></label>
        <label class="field"><span>Hostname</span><input id="env-hostname"></label>
        <label class="field"><span>Port</span><input id="env-port" type="number" min="0" max="65535"></label>
        <label class="field"><span>Global latency</span><input id="env-latency" type="number" min="0"></label>
        <label class="check-card"><input id="env-cors" type="checkbox"><span><b>Automatic CORS</b><small>Handle OPTIONS pre-flight requests.</small></span></label>
      </div>
      <div class="feature-section"><h3>Proxy</h3><div class="feature-form-grid">
        <label class="check-card"><input id="env-proxy-mode" type="checkbox"><span><b>Enable proxy mode</b><small>Forward unmatched routes to a target.</small></span></label>
        <label class="check-card"><input id="env-proxy-remove-prefix" type="checkbox"><span><b>Remove API prefix</b><small>Do not forward the local endpoint prefix.</small></span></label>
        <label class="field span-all"><span>Proxy target URL</span><input id="env-proxy-host" placeholder="https://api.example.com"></label>
      </div><div class="feature-form-grid">
        <div><div class="feature-kv-title"><b>Proxy request headers</b><button class="mini-button" id="add-proxy-request-header" type="button">＋ Add</button></div><div class="kv-table" id="proxy-request-headers"></div></div>
        <div><div class="feature-kv-title"><b>Proxy response headers</b><button class="mini-button" id="add-proxy-response-header" type="button">＋ Add</button></div><div class="kv-table" id="proxy-response-headers"></div></div>
      </div></div>
      <div class="feature-section"><h3>TLS</h3><div class="feature-form-grid">
        <label class="check-card"><input id="env-tls-enabled" type="checkbox"><span><b>Enable TLS</b><small>Requires Mockoon restart after changes.</small></span></label>
        <label class="field"><span>Certificate type</span><select id="env-tls-type" class="small-select"><option value="CERT">Certificate + key</option><option value="PFX">PFX / PKCS12</option></select></label>
        <label class="field"><span>Certificate path</span><input id="env-cert-path"></label>
        <label class="field"><span>Private key path</span><input id="env-key-path"></label>
        <label class="field"><span>CA path</span><input id="env-ca-path"></label>
        <label class="field"><span>PFX path</span><input id="env-pfx-path"></label>
        <label class="field span-all"><span>Passphrase</span><input id="env-passphrase" type="password"></label>
      </div></div>
    </div>`;
  const values = {
    '#env-name': environment.name, '#env-prefix': environment.endpointPrefix, '#env-hostname': environment.hostname,
    '#env-port': environment.port, '#env-latency': environment.latency, '#env-proxy-host': environment.proxyHost,
    '#env-tls-type': environment.tlsOptions.type, '#env-cert-path': environment.tlsOptions.certPath,
    '#env-key-path': environment.tlsOptions.keyPath, '#env-ca-path': environment.tlsOptions.caPath,
    '#env-pfx-path': environment.tlsOptions.pfxPath, '#env-passphrase': environment.tlsOptions.passphrase
  };
  Object.entries(values).forEach(([selector, value]) => { $(selector).value = value ?? ''; });
  $('#env-cors').checked = environment.cors;
  $('#env-proxy-mode').checked = environment.proxyMode;
  $('#env-proxy-remove-prefix').checked = environment.proxyRemovePrefix;
  $('#env-tls-enabled').checked = environment.tlsOptions.enabled;
  bindObjectInput('#env-name', environment, 'name', String, () => { elements.environmentName.textContent = environment.name; });
  bindObjectInput('#env-prefix', environment, 'endpointPrefix');
  bindObjectInput('#env-hostname', environment, 'hostname');
  bindObjectInput('#env-port', environment, 'port', Number);
  bindObjectInput('#env-latency', environment, 'latency', Number);
  bindObjectInput('#env-cors', environment, 'cors', Boolean, null, 'change');
  bindObjectInput('#env-proxy-mode', environment, 'proxyMode', Boolean, null, 'change');
  bindObjectInput('#env-proxy-remove-prefix', environment, 'proxyRemovePrefix', Boolean, null, 'change');
  bindObjectInput('#env-proxy-host', environment, 'proxyHost');
  bindObjectInput('#env-tls-enabled', environment.tlsOptions, 'enabled', Boolean, null, 'change');
  bindObjectInput('#env-tls-type', environment.tlsOptions, 'type', String, null, 'change');
  bindObjectInput('#env-cert-path', environment.tlsOptions, 'certPath');
  bindObjectInput('#env-key-path', environment.tlsOptions, 'keyPath');
  bindObjectInput('#env-ca-path', environment.tlsOptions, 'caPath');
  bindObjectInput('#env-pfx-path', environment.tlsOptions, 'pfxPath');
  bindObjectInput('#env-passphrase', environment.tlsOptions, 'passphrase');
  renderKeyValueEditor(environment.proxyReqHeaders, $('#proxy-request-headers'), 'proxy-request-header');
  renderKeyValueEditor(environment.proxyResHeaders, $('#proxy-response-headers'), 'proxy-response-header');
  $('#add-proxy-request-header').addEventListener('click', () => { environment.proxyReqHeaders.push({ key: '', value: '' }); renderFeature(); markDirty('add-proxy-request-header'); });
  $('#add-proxy-response-header').addEventListener('click', () => { environment.proxyResHeaders.push({ key: '', value: '' }); renderFeature(); markDirty('add-proxy-response-header'); });
}

function bindObjectInput(selector, object, property, transform = String, after = null, eventName = 'input') {
  $(selector)?.addEventListener(eventName, (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    object[property] = transform(raw);
    after?.();
    markDirty(`edit-${property}`);
  });
}

function renderKeyValueEditor(items, container, reason) {
  container.replaceChildren();
  if (!items.length) {
    container.innerHTML = '<div class="empty-table">No headers configured.</div>';
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = '<input placeholder="Header name"><input placeholder="Value"><button class="remove-row" type="button">×</button>';
    const inputs = $$('input', row);
    inputs[0].value = item.key || '';
    inputs[1].value = item.value || '';
    inputs[0].addEventListener('input', (event) => { item.key = event.target.value; markDirty(reason); });
    inputs[1].addEventListener('input', (event) => { item.value = event.target.value; markDirty(reason); });
    $('button', row).addEventListener('click', () => { items.splice(index, 1); renderFeature(); markDirty(`delete-${reason}`); });
    container.append(row);
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
    state.environment = normalizeEnvironment(result.environment);
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
    const environment = normalizeEnvironment(JSON.parse(await file.text()));
    const errors = validateEnvironmentSchema(environment);
    if (errors.length) throw new Error(errors.join(' '));
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
  elements.featurePanel.classList.add('hidden');
  $$('.environment-nav button').forEach((button) => button.classList.remove('active'));
  elements.rawPanel.classList.remove('hidden');
  elements.rawEditor.value = JSON.stringify(state.environment, null, 2);
}

function applyRawJson() {
  try {
    const environment = normalizeEnvironment(JSON.parse(elements.rawEditor.value));
    const errors = validateEnvironmentSchema(environment);
    if (errors.length) throw new Error(errors.join(' '));
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

function addFeatureItem() {
  if (state.activeFeature === 'databuckets') {
    const bucket = buildDataBucket();
    state.environment.data.push(bucket);
    state.selectedFeatureId = bucket.uuid;
    renderFeature();
    $('#bucket-name')?.focus();
    markDirty('add-databucket');
    return;
  }
  if (state.activeFeature === 'callbacks') {
    const callback = buildCallback();
    state.environment.callbacks.push(callback);
    state.selectedFeatureId = callback.uuid;
    renderFeature();
    $('#callback-name')?.focus();
    markDirty('add-callback');
    return;
  }
  if (state.activeFeature === 'headers') {
    state.environment.headers.push({ key: '', value: '' });
    renderFeature();
    markDirty('add-environment-header');
  }
}

function insertBodySnippet(snippet) {
  const response = currentResponse();
  if (!response || !snippet) return;
  const editor = elements.responseBody;
  const start = editor.selectionStart ?? editor.value.length;
  const end = editor.selectionEnd ?? start;
  editor.value = `${editor.value.slice(0, start)}${snippet}${editor.value.slice(end)}`;
  editor.selectionStart = editor.selectionEnd = start + snippet.length;
  response.body = editor.value;
  editor.focus();
  updateLineNumbers();
  updateJsonStatus();
  markDirty('insert-template-helper');
}

function changeRouteType(type) {
  const route = currentRoute();
  if (!route) return;
  route.type = type;
  if (type === 'crud') {
    route.method = '';
    route.responses.forEach((response, index) => { response.default = index === 0; });
    if (route.responses[0]) route.responses[0].bodyType = 'DATABUCKET';
  }
  else if (!route.method) route.method = 'get';
  if (type !== 'ws') {
    route.streamingMode = null;
    route.streamingInterval = 0;
  }
  renderEditor();
  renderRouteList();
  markDirty('change-route-type');
}

function bindEvents() {
  $('#add-route-button').addEventListener('click', () => addRoute());
  $('#empty-add-route').addEventListener('click', () => addRoute());
  $('#add-folder-button').addEventListener('click', addFolder);
  $$('.environment-nav button').forEach((button) => button.addEventListener('click', () => openFeature(button.dataset.feature)));
  $('#feature-add-button').addEventListener('click', addFeatureItem);
  $('#feature-back-button').addEventListener('click', () => { state.activeFeature = null; renderEditor(); });
  $('#delete-route-button').addEventListener('click', deleteRoute);
  $('#add-response-button').addEventListener('click', addResponse);
  $('#delete-response-button').addEventListener('click', deleteResponse);
  elements.routeSearch.addEventListener('input', (event) => { state.routeFilter = event.target.value; renderRouteList(); });

  elements.routeType.addEventListener('change', (event) => changeRouteType(event.target.value));
  elements.routeMethod.addEventListener('change', (event) => {
    const route = currentRoute(); if (!route) return;
    route.method = event.target.value;
    elements.routeMethod.className = `method-select ${methodClass(route.method)}`;
    renderRouteList(); markDirty('edit-route');
  });
  elements.routeEndpoint.addEventListener('input', (event) => { const route = currentRoute(); if (!route) return; route.endpoint = event.target.value.replace(/^\/+/, ''); renderRouteList(); markDirty('edit-route'); });
  elements.routeDocumentation.addEventListener('input', (event) => { const route = currentRoute(); if (!route) return; route.documentation = event.target.value; renderRouteList(); markDirty('edit-route'); });
  elements.routeResponseMode.addEventListener('change', (event) => { const route = currentRoute(); if (!route) return; route.responseMode = event.target.value || null; markDirty('response-mode'); });
  elements.routeFolder.addEventListener('change', (event) => { const route = currentRoute(); if (!route) return; moveRouteToFolder(route.uuid, event.target.value); });
  elements.routeStreamingMode.addEventListener('change', (event) => {
    const route = currentRoute(); if (!route) return;
    route.streamingMode = event.target.value || null;
    $('#streaming-interval-field').classList.toggle('hidden', !route.streamingMode);
    markDirty('streaming-mode');
  });
  elements.routeStreamingInterval.addEventListener('input', (event) => { const route = currentRoute(); if (!route) return; route.streamingInterval = Number(event.target.value) || 0; markDirty('streaming-interval'); });

  bindInput(elements.responseStatus, 'statusCode', Number, () => renderResponseList());
  bindInput(elements.responseLabel, 'label', String, () => renderResponseList());
  bindInput(elements.responseLatency, 'latency', Number);
  bindInput(elements.responseBody, 'body', String, () => { updateLineNumbers(); updateJsonStatus(); });
  bindInput(elements.responseFilePath, 'filePath');
  bindInput(elements.responseBucketId, 'databucketID');
  bindInput(elements.disableTemplating, 'disableTemplating', Boolean);
  bindInput(elements.fallback404, 'fallbackTo404', Boolean);
  bindInput(elements.sendFileAsBody, 'sendFileAsBody', Boolean);
  bindInput(elements.responseCrudKey, 'crudKey');

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
  $('#add-rule-button').addEventListener('click', () => { currentResponse().rules.push(buildRule()); renderRules(); markDirty('add-rule'); });
  $('#add-response-callback-button').addEventListener('click', () => {
    const response = currentResponse();
    if (!response) return;
    const callback = state.environment.callbacks[0];
    if (!callback) {
      openFeature('callbacks');
      toast('Create a callback first', 'Callbacks are reusable across route responses.');
      return;
    }
    response.callbacks.push({ uuid: callback.uuid, latency: 0 });
    renderResponseCallbacks();
    markDirty('add-response-callback');
  });
  const snippetSelect = $('#faker-snippet-select');
  snippetSelect.insertAdjacentHTML('beforeend', FAKER_SNIPPETS.map((snippet) => `<option value="${escapeHtml(snippet.value)}">${escapeHtml(snippet.label)}</option>`).join(''));
  snippetSelect.addEventListener('change', (event) => { insertBodySnippet(event.target.value); event.target.value = ''; });
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
    state.environment = normalizeEnvironment(environmentResult.environment);
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
