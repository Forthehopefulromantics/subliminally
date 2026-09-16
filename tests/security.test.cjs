const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('credit-spending AI endpoints use server authorization', () => {
  for (const file of [
    'api/generate-affirmations.js',
    'api/generate-eft-affirmations.js',
    'api/generate-visualization-script.js',
  ]) {
    const source = read(file);
    assert.match(source, /authorizeAiRequest/);
    assert.match(source, /sendAuthorizationError/);
  }
});

test('premium AI modes are enforced on the server', () => {
  assert.match(read('api/generate-eft-affirmations.js'), /requiredTier: 'ritual'/);
  assert.match(read('api/generate-visualization-script.js'), /requiredTier: 'ritual'/);
});

test('browser sends a user access token to AI routes', () => {
  const source = read('js/builder.js');
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
});

test('launch notes contain no RevenueCat secret value', () => {
  const source = read('LAUNCH.md');
  assert.doesNotMatch(source, /dhEdleK-okLF-HlqrfZLVGrU4O5S2szsBRYsxo7xFlo/);
  assert.doesNotMatch(source, /REVENUECAT_WEBHOOK_AUTH\s*=\s*`[^`]+`/);
});

test('Vercel security headers are valid and present', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = config.headers[0].headers;
  const names = new Set(headers.map((header) => header.key));
  for (const name of ['Content-Security-Policy', 'Referrer-Policy', 'X-Content-Type-Options', 'X-Frame-Options']) {
    assert.ok(names.has(name), `${name} is missing`);
  }
});

test('feedback webhook requires a shared authorization value', () => {
  const source = read('api/notify-feedback.js');
  assert.match(source, /FEEDBACK_WEBHOOK_AUTH/);
  assert.match(source, /timingSafeEqual/);
});
