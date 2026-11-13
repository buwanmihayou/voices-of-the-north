import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVID = resolve(__dirname, '../evidence');
const BASE = 'http://127.0.0.1:8421/voices-of-the-north-app.html';
const TEST_ID = 'EVID-REC-TEST';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 820, height: 900 },
];

async function shoot(page, name) {
  await page.screenshot({ path: resolve(EVID, name + '.png') });
  console.log('SHOT', name);
}

async function skipOnboard(page) {
  const skip = page.locator('#onboardSkip');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(300);
  }
}

const fresh = Date.now();

function injectTestRecord(page) {
  return page.evaluate((id) => {
    if (VTN.store.records.get(id)) VTN.store.records.remove(id);
    VTN.store.records.save({
      id, title: '測試錄音', status: 'done', source: 'live', scope: 'private',
      durationSec: 10, rawText: 'x', formalText: 'x', qaList: [], words: [],
      createdAt: Date.now(),
    });
    if (VTN.recordings.showTab) VTN.recordings.showTab('done');
    VTN.recordings.renderAll();
  }, TEST_ID);
}

function expandTestCard(page) {
  return page.evaluate((id) => {
    const c = document.getElementById('rec-' + id);
    if (c) { const h = c.querySelector('.vtn-rec-card__head'); if (h) h.click(); }
  }, TEST_ID);
}

function cleanTestRecord(page) {
  return page.evaluate((id) => {
    if (VTN.store.records.get(id)) VTN.store.records.remove(id);
  }, TEST_ID);
}

async function captureViewports() {
  for (const vp of viewports) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // 1) Stories 地图铺满 + pin 可见
    await page.goto(`${BASE}?fresh=${fresh}#stories`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await skipOnboard(page);
    await page.waitForTimeout(400);
    await shoot(page, `${vp.name}-stories`);

    // 2) 媒体弹窗（在手机外壳内 + 示例标签）
    await page.evaluate(() => {
      const l = (VTN.stories && VTN.stories.visible) ? VTN.stories.visible() : [];
      if (l.length) VTN.media.open(l[0]);
    });
    await page.waitForTimeout(900);
    await shoot(page, `${vp.name}-media`);

    // 3) 录音页卡片展开 — 图标选择器可见
    await page.goto(`${BASE}?fresh=${fresh}#recording`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await injectTestRecord(page);
    await page.waitForTimeout(600);
    await expandTestCard(page);
    await page.waitForTimeout(700);
    await shoot(page, `${vp.name}-recording`);
    await cleanTestRecord(page);

    // 4) 设置页
    await page.goto(`${BASE}?fresh=${fresh}#settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await shoot(page, `${vp.name}-settings`);

    await context.close();
    await browser.close();
  }
}

async function recordWalkthrough() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: EVID, size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?fresh=${fresh}#stories`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await skipOnboard(page);
  await page.waitForTimeout(400);

  // 点地图 pin → 故事弹窗
  try {
    await page.locator('.vtn-pin').first().click({ timeout: 4000 });
  } catch (e) {
    await page.evaluate(() => {
      const l = (VTN.stories && VTN.stories.visible) ? VTN.stories.visible() : [];
      if (l.length && VTN.stories.openSheet) VTN.stories.openSheet(l[0]);
    });
  }
  await page.waitForTimeout(5000);

  // 切录音页并展开图标选择器
  await page.evaluate(() => { location.hash = 'recording'; });
  await page.waitForTimeout(1500);
  await injectTestRecord(page);
  await page.waitForTimeout(2000);
  await expandTestCard(page);
  await page.waitForTimeout(18000);

  await context.close();
  const video = await page.video();
  if (video) await video.saveAs(resolve(EVID, 'walkthrough.webm'));
  await browser.close();
}

(async () => {
  await captureViewports();
  await recordWalkthrough();
  console.log('EVIDENCE_DONE');
})().catch((e) => { console.error('EVIDENCE_FAIL', e); process.exit(1); });
