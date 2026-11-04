// Isolated checks against a captured deployment; never accesses browser storage.
import fs from 'node:fs';
import vm from 'node:vm';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error('Usage: node tools/audit_frontend.mjs input.html output.json');
const html = fs.readFileSync(input, 'utf8');
const checks = [];
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
for (const [i, match] of scripts.entries()) {
  try { new vm.Script(match[1]); checks.push({check: `script-${i + 1}-syntax`, passed: true}); }
  catch (error) { checks.push({check: `script-${i + 1}-syntax`, passed: false, error: error.message}); }
}
const corpus = html.split('/* ===== lib/storyCorpus.js ===== */')[1].split('/* ===== js/demo-audio.js ===== */')[0];
const ctx = vm.createContext({});
vm.runInContext(corpus, ctx);
checks.push({check: 'published-story-count', value: vm.runInContext('RECORDED_STORIES.length', ctx)});
for (const question of ['以前居民主要用咩出行？', '火星天氣如何？']) {
  checks.push({check: 'story-retrieval', question,
    result: vm.runInContext(`retrieveAnswer(${JSON.stringify(question)})`, ctx)});
}

const storageCode = html.slice(html.indexOf('var API_BASE ='), html.indexOf('window.VTNRecords = VTNRecords;') + 'window.VTNRecords = VTNRecords;'.length);
const values = new Map();
const storeContext = vm.createContext({window: {location: {origin: 'https://audit.invalid'}},
  localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}});
vm.runInContext(storageCode, storeContext);
const store = storeContext.window.VTNRecords;
store.save({id: 'audit-old', rawText: 'Synthetic audit data', audioDataURL: 'old-audio'});
checks.push({check: 'save-and-reopen', passed: store.get('audit-old')?.rawText === 'Synthetic audit data'});
store.remove('audit-old');
checks.push({check: 'delete-isolated-record', passed: store.get('audit-old') === null});
store.save({id: 'audit-old', audioDataURL: 'a'.repeat(4 * 1024 * 1024)});
store.save({id: 'audit-new', audioDataURL: 'b'.repeat(4 * 1024 * 1024)});
checks.push({check: 'quota-pruning', oldestAudioRetained: Boolean(store.get('audit-old').audioDataURL),
  newestAudioRetained: Boolean(store.get('audit-new').audioDataURL),
  note: 'The implementation comment says oldest audio should be discarded first.'});
for (const id of ['langSheet', 'langOverlay', 'langSheetClose', 'langSheetCancel']) {
  checks.push({check: 'language-dialog-markup', id, present: new RegExp(`id=["']${id}["']`).test(html)});
}
fs.writeFileSync(output, JSON.stringify({input, checks}, null, 2) + '\n');
console.log(JSON.stringify(checks, null, 2));
