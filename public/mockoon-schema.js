// Data model mirrored from Mockoon's MIT-licensed commons package.
// Reference: packages/commons/src/models and environment-schema.constants.ts.

export const HTTP_METHODS = [
  'all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
  'propfind', 'proppatch', 'move', 'copy', 'mkcol', 'lock', 'unlock'
];

export const ROUTE_TYPES = [
  { value: 'http', label: 'HTTP route' },
  { value: 'crud', label: 'CRUD route' },
  { value: 'ws', label: 'WebSocket route' }
];

export const RESPONSE_MODES = [
  { value: '', label: 'Rules + default' },
  { value: 'RANDOM', label: 'Random response' },
  { value: 'SEQUENTIAL', label: 'Sequential responses' },
  { value: 'DISABLE_RULES', label: 'Default only (disable rules)' },
  { value: 'FALLBACK', label: 'Rules with fallback' }
];

export const STREAMING_MODES = [
  { value: '', label: 'No streaming' },
  { value: 'UNICAST', label: 'Unicast' },
  { value: 'BROADCAST', label: 'Broadcast' }
];

export const RULE_TARGETS = [
  { value: 'body', label: 'Body', modifier: true },
  { value: 'query', label: 'Query parameter', modifier: true },
  { value: 'header', label: 'Header', modifier: true },
  { value: 'cookie', label: 'Cookie', modifier: true },
  { value: 'params', label: 'Route parameter', modifier: true },
  { value: 'path', label: 'Request path', modifier: false },
  { value: 'method', label: 'Request method', modifier: false },
  { value: 'request_number', label: 'Request number', modifier: false },
  { value: 'global_var', label: 'Global variable', modifier: true },
  { value: 'data_bucket', label: 'Data bucket', modifier: true },
  { value: 'templating', label: 'Custom template', modifier: true }
];

export const RULE_OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'regex', label: 'regex' },
  { value: 'regex_i', label: 'regex (case-insensitive)' },
  { value: 'null', label: 'is null / absent', noValue: true },
  { value: 'empty_array', label: 'is empty array', noValue: true },
  { value: 'array_includes', label: 'array includes' },
  { value: 'valid_json_schema', label: 'valid JSON schema' }
];

export const FAKER_SNIPPETS = [
  { label: 'UUID', value: "{{faker 'string.uuid'}}" },
  { label: 'Full name', value: "{{faker 'person.fullName'}}" },
  { label: 'Email', value: "{{faker 'internet.email'}}" },
  { label: 'Phone', value: "{{faker 'phone.number'}}" },
  { label: 'Company', value: "{{faker 'company.name'}}" },
  { label: 'Date', value: "{{faker 'date.recent'}}" },
  { label: 'Integer', value: "{{faker 'number.int' min=1 max=100}}" },
  { label: 'Boolean', value: "{{faker 'datatype.boolean'}}" },
  { label: 'Lorem', value: "{{faker 'lorem.sentence'}}" },
  { label: 'Request body', value: "{{body 'property'}}" },
  { label: 'URL parameter', value: "{{urlParam 'id'}}" },
  { label: 'Header', value: "{{header 'x-header'}}" }
];

export function newUuid() {
  return crypto.randomUUID();
}

export function shortId(length = 6) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export function buildRule() {
  return { target: 'body', modifier: '', value: '', invert: false, operator: 'equals' };
}

export function buildResponse({ isDefault = true } = {}) {
  return {
    uuid: newUuid(),
    body: '{\n  "ok": true\n}',
    latency: 0,
    statusCode: 200,
    label: 'Success',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    bodyType: 'INLINE',
    filePath: '',
    databucketID: '',
    sendFileAsBody: false,
    rules: [],
    rulesOperator: 'OR',
    disableTemplating: false,
    fallbackTo404: false,
    default: isDefault,
    crudKey: 'id',
    callbacks: []
  };
}

export function buildRoute(type = 'http') {
  const response = buildResponse();
  if (type === 'crud') {
    response.bodyType = 'DATABUCKET';
    response.databucketID = '';
  }
  if (type === 'ws') response.sendFileAsBody = true;
  return {
    uuid: newUuid(),
    type,
    documentation: '',
    method: type === 'crud' ? '' : 'get',
    endpoint: type === 'ws' ? 'socket' : type === 'crud' ? 'resources' : 'new-route',
    responses: [response],
    responseMode: null,
    streamingMode: null,
    streamingInterval: type === 'ws' ? 100 : 0
  };
}

export function buildDataBucket() {
  return {
    uuid: newUuid(),
    id: shortId(),
    name: 'New data bucket',
    documentation: '',
    value: '[\n  { "id": 1 }\n]'
  };
}

export function buildCallback() {
  return {
    uuid: newUuid(),
    id: shortId(),
    name: 'New callback',
    documentation: '',
    method: 'post',
    uri: '/callback',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    bodyType: 'INLINE',
    body: '{}',
    databucketID: '',
    filePath: '',
    sendFileAsBody: true
  };
}

export function buildFolder() {
  return { uuid: newUuid(), name: 'New folder', children: [] };
}

export function normalizeEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) return environment;
  environment.folders ||= [];
  environment.rootChildren ||= [];
  environment.headers ||= [];
  environment.proxyReqHeaders ||= [];
  environment.proxyResHeaders ||= [];
  environment.data ||= [];
  environment.callbacks ||= [];
  environment.cors ??= true;
  environment.proxyMode ??= false;
  environment.proxyHost ??= '';
  environment.proxyRemovePrefix ??= false;
  environment.tlsOptions ||= {
    enabled: false, type: 'CERT', pfxPath: '', certPath: '', keyPath: '', caPath: '', passphrase: ''
  };
  environment.routes ||= [];
  if (!Array.isArray(environment.routes)) return environment;
  environment.routes.forEach((route) => {
    if (!route || typeof route !== 'object' || Array.isArray(route)) return;
    route.type ||= 'http';
    route.documentation ??= '';
    route.method ??= route.type === 'crud' ? '' : 'get';
    route.endpoint ??= '';
    route.responses ||= [];
    route.responseMode ??= null;
    route.streamingMode ??= null;
    route.streamingInterval ??= 0;
    if (!Array.isArray(route.responses)) return;
    route.responses.forEach((response, index) => {
      if (!response || typeof response !== 'object' || Array.isArray(response)) return;
      response.rules ||= [];
      response.rulesOperator ||= 'OR';
      response.headers ||= [];
      response.callbacks ||= [];
      response.body ??= '';
      response.latency ??= 0;
      response.statusCode ??= 200;
      response.label ??= '';
      response.bodyType ||= 'INLINE';
      response.filePath ??= '';
      response.databucketID ??= '';
      response.sendFileAsBody ??= false;
      response.disableTemplating ??= false;
      response.fallbackTo404 ??= false;
      response.default ??= index === 0;
      response.crudKey ??= 'id';
      if (!Array.isArray(response.rules)) return;
      response.rules.forEach((rule) => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return;
        rule.target ||= 'body';
        rule.modifier ??= '';
        rule.value ??= '';
        rule.invert ??= false;
        rule.operator ||= 'equals';
      });
    });
  });
  return environment;
}

export function validateEnvironmentSchema(environment) {
  const errors = [];
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) return ['Environment must be a JSON object.'];
  if (!environment.uuid || typeof environment.uuid !== 'string') errors.push('Environment uuid is required.');
  if (typeof environment.name !== 'string') errors.push('Environment name is required.');
  if (!Array.isArray(environment.routes)) errors.push('Environment routes must be an array.');
  if (!Array.isArray(environment.folders)) errors.push('Environment folders must be an array.');
  if (!Array.isArray(environment.rootChildren)) errors.push('Environment rootChildren must be an array.');
  if (!Array.isArray(environment.data)) errors.push('Environment data buckets must be an array.');
  if (!Array.isArray(environment.callbacks)) errors.push('Environment callbacks must be an array.');
  if (!Array.isArray(environment.routes)) return errors;
  environment.routes.forEach((route, routeIndex) => {
    const prefix = `Route ${routeIndex + 1}`;
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }
    if (!route.uuid) errors.push(`${prefix} is missing uuid.`);
    if (!ROUTE_TYPES.some((item) => item.value === route.type)) errors.push(`${prefix} has an unsupported type.`);
    if (route.type !== 'crud' && !HTTP_METHODS.includes(route.method)) errors.push(`${prefix} has an unsupported HTTP method.`);
    if (route.type === 'crud' && route.method !== '') errors.push(`${prefix} CRUD method must be empty.`);
    if (!Array.isArray(route.responses) || !route.responses.length) errors.push(`${prefix} must have at least one response.`);
    if (route.responseMode && !RESPONSE_MODES.some((item) => item.value === route.responseMode)) errors.push(`${prefix} has an unsupported response mode.`);
    if (route.streamingMode && !STREAMING_MODES.some((item) => item.value === route.streamingMode)) errors.push(`${prefix} has an unsupported streaming mode.`);
    if (!Array.isArray(route.responses)) return;
    route.responses.forEach((response, responseIndex) => {
      const responsePrefix = `${prefix}, response ${responseIndex + 1}`;
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        errors.push(`${responsePrefix} must be an object.`);
        return;
      }
      if (!response.uuid) errors.push(`${responsePrefix} is missing uuid.`);
      if (!Array.isArray(response.rules)) errors.push(`${responsePrefix} rules must be an array.`);
      if (!['INLINE', 'FILE', 'DATABUCKET'].includes(response.bodyType)) errors.push(`${responsePrefix} has an unsupported body type.`);
      if (!['AND', 'OR'].includes(response.rulesOperator)) errors.push(`${responsePrefix} has an unsupported rules operator.`);
      if (!Array.isArray(response.rules)) return;
      response.rules.forEach((rule, ruleIndex) => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
          errors.push(`${responsePrefix}, rule ${ruleIndex + 1} must be an object.`);
          return;
        }
        if (!RULE_TARGETS.some((item) => item.value === rule.target)) errors.push(`${responsePrefix}, rule ${ruleIndex + 1} has an unsupported target.`);
        if (!RULE_OPERATORS.some((item) => item.value === rule.operator)) errors.push(`${responsePrefix}, rule ${ruleIndex + 1} has an unsupported operator.`);
      });
    });
  });
  return errors;
}
