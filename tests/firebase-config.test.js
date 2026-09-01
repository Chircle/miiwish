const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScriptWithWindow(windowState) {
  const scriptPath = path.join(__dirname, '..', 'script.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  const browserWindow = { ...(windowState || {}) };
  const context = {
    window: browserWindow,
    globalThis: browserWindow,
    document: undefined,
    localStorage: {
      getItem: () => null,
      setItem: () => {}
    },
    firebase: undefined,
    console,
    setTimeout,
    clearTimeout,
    URL,
    DOMParser: class {
      parseFromString() {
        return {
          querySelector: () => null,
          querySelectorAll: () => []
        };
      }
    },
    module: { exports: {} },
    exports: {}
  };
  context.window = browserWindow;
  context.globalThis = browserWindow;
  vm.runInNewContext(scriptSource, context, { filename: scriptPath });
  return context.module.exports;
}

test('resolveFirebaseConfig prefers the generated global Firebase config', () => {
  const { resolveFirebaseConfig } = loadScriptWithWindow({
    MIIWISH_FIREBASE_CONFIG: {
      apiKey: 'test-api-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'miiwish-demo',
      storageBucket: 'miiwish-demo.appspot.com',
      messagingSenderId: '123456789',
      appId: 'app-id-123'
    }
  });

  const actual = { ...resolveFirebaseConfig() };

  assert.deepEqual(actual, {
    apiKey: 'test-api-key',
    authDomain: 'example.firebaseapp.com',
    projectId: 'miiwish-demo',
    storageBucket: 'miiwish-demo.appspot.com',
    messagingSenderId: '123456789',
    appId: 'app-id-123'
  });
});

test('resolveFirebaseConfig falls back to empty defaults when no Firebase config is present', () => {
  const { resolveFirebaseConfig } = loadScriptWithWindow({});
  const actual = { ...resolveFirebaseConfig() };

  assert.deepEqual(actual, {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  });
});

test('resolveFirebaseConfig uses env-like values before the generated config fields', () => {
  const { resolveFirebaseConfig } = loadScriptWithWindow({
    __MIIWISH_ENV__: {
      projectId: 'env-project',
      apiKey: 'env-api-key'
    },
    MIIWISH_FIREBASE_CONFIG: {
      projectId: 'generated-project',
      apiKey: 'generated-api-key'
    }
  });

  assert.equal(resolveFirebaseConfig().projectId, 'generated-project');
  assert.equal(resolveFirebaseConfig().apiKey, 'generated-api-key');
});

test('shouldUseDemoMode turns on demo mode when Firebase is missing or config is incomplete', () => {
  const { shouldUseDemoMode } = loadScriptWithWindow({
    MIIWISH_FIREBASE_CONFIG: {
      apiKey: 'real-key',
      projectId: 'real-project'
    }
  });

  assert.equal(shouldUseDemoMode({ apiKey: '', projectId: 'real-project' }, true), true);
  assert.equal(shouldUseDemoMode({ apiKey: 'real-key', projectId: 'YOUR_PROJECT' }, true), true);
  assert.equal(shouldUseDemoMode({ apiKey: 'real-key', projectId: 'real-project' }, false), true);
  assert.equal(shouldUseDemoMode({ apiKey: 'real-key', projectId: 'real-project' }, true), false);
});

test('normalizeRequestData keeps the important access-request fields and trims whitespace', () => {
  const { normalizeRequestData } = loadScriptWithWindow({});
  const request = normalizeRequestData({
    name: '  Max Mustermann  ',
    email: '  max@example.com  ',
    reason: '  Ich möchte die Liste sehen.  '
  });

  assert.equal(request.name, 'Max Mustermann');
  assert.equal(request.email, 'max@example.com');
  assert.equal(request.reason, 'Ich möchte die Liste sehen.');
});

test('normalizeItemInput cleans manual product input and preserves the image URL', () => {
  const { normalizeItemInput } = loadScriptWithWindow({});
  const item = normalizeItemInput({
    title: '  Buch  ',
    price: '  19,99 €  ',
    url: '  https://shop.example/buch  ',
    description: '  Super Buch  ',
    image: '  https://images.example/buch.jpg  '
  });

  assert.equal(item.title, 'Buch');
  assert.equal(item.price, '19,99 €');
  assert.equal(item.url, 'https://shop.example/buch');
  assert.equal(item.description, 'Super Buch');
  assert.equal(item.image, 'https://images.example/buch.jpg');
});
