// End-to-end test: loads the unpacked extension in Chromium, serves a fake
// WhatsApp Web at https://web.whatsapp.com/, drives the panel and checks the
// exported files. Usage: node test/e2e.cjs <extension-dir> <work-dir>
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [extDir, workDir] = process.argv.slice(2).map((p) => path.resolve(p));
const mockJs = fs.readFileSync(path.join(__dirname, 'mock-wa.js'), 'utf8');
const html = '<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp</title>' +
  '<script src="/mock-wa.js"></script></head><body><div id="app">WhatsApp mock</div></body></html>';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`);
  }
}

async function waitForLog(page, pattern, timeout = 60_000) {
  await page.waitForFunction(
    (source) => [...document.querySelectorAll('#wat-root .wat-log li')].some((li) => new RegExp(source).test(li.textContent)),
    pattern.source,
    { timeout },
  );
}

(async () => {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(workDir, 'profile'), {
    headless: true,
    channel: 'chromium',
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const pageErrors = [];
  await context.route('https://web.whatsapp.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mock-wa.js') return route.fulfill({ contentType: 'text/javascript', body: mockJs });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  check('service worker registered', () => assert.match(worker.url(), /^chrome-extension:\/\/[a-p]{32}\/sw\.js$/));

  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('https://web.whatsapp.com/');
  await page.waitForFunction(() => window.__waTools?.panelLoaded === true);

  // Same path as a toolbar click: service worker -> bridge -> page panel.
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    await toggle(tab);
  });
  await page.waitForSelector('#wat-root:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#wat-root .wat-status')?.textContent.startsWith('Hazır'));
  const rows = await page.$$eval('#wat-root .wat-row .wat-title', (els) => els.map((e) => e.textContent));
  check('chat list hides archived chats and status broadcast', () =>
    assert.deepEqual(rows, ['Ayşe Yılmaz', 'Proje Ekibi', 'Boş/Sohbet: test?']));

  // ---- Run 1: folder output (origin-private file system), all chats ----
  await page.click('text=Görünenleri seç');
  await page.check('#wat-root input[name="output"][value="folder"]');
  await page.click('text=Dışa aktarmayı başlat');
  await waitForLog(page, /Tamamlandı/);
  const files = await page.evaluate(async () => {
    const out = {};
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const p = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === 'directory') await walk(handle, p);
        else out[p] = await (await handle.getFile()).text();
      }
    }
    const opfs = await navigator.storage.getDirectory();
    await walk(await opfs.getDirectoryHandle('secilen-klasor'), '');
    return out;
  });
  const roots = [...new Set(Object.keys(files).map((p) => p.split('/')[0]))];
  check('one export root folder', () => assert.equal(roots.length, 1));
  const R = roots[0];
  const f = (p) => files[`${R}/${p}`];
  const summary = JSON.parse(f('disa-aktarim.json'));
  const chat1 = JSON.parse(f('Ayşe Yılmaz/mesajlar.json'));
  const chat2 = JSON.parse(f('Proje Ekibi/mesajlar.json'));
  const chat3 = JSON.parse(f('Boş Sohbet test/mesajlar.json'));
  const html1 = f('Ayşe Yılmaz/sohbet.html');
  const csv1 = f('Ayşe Yılmaz/mesajlar.csv');
  const txt1 = f('Ayşe Yılmaz/sohbet.txt');

  check('summary covers three chats, not aborted', () => {
    assert.equal(summary.chats.length, 3);
    assert.equal(summary.aborted, false);
  });
  check('full history loaded through loadEarlierMsgs (229 visible of 230)', () => {
    assert.equal(chat1.messageCount, 229);
    assert.equal(chat1.history.reachedStart, true);
    assert.equal(chat1.history.complete, true);
  });
  check('protocol entries hidden', () => assert.ok(!chat1.messages.some((m) => m.type === 'protocol')));
  check('media thumbnails never exported as text', () => {
    for (const [p, text] of Object.entries(files)) assert.ok(!text.includes('A'.repeat(200)), p);
  });
  check('image, document and voice note saved with original bytes', () => {
    const media = Object.keys(files).filter((p) => p.startsWith(`${R}/Ayşe Yılmaz/media/`));
    assert.equal(media.length, 3, media.join(', '));
    assert.ok(media.some((p) => p.endsWith('_Rapor 2026.pdf')), 'document keeps its file name');
    assert.ok(media.some((p) => p.endsWith('.ogg')), 'voice note extension');
    const img = chat1.messages.find((m) => m.key === 'ID5');
    assert.equal(files[`${R}/Ayşe Yılmaz/${img.media.file}`], 'MEDIA:/img/5');
    assert.equal(img.text, 'Tatil 🌴');
  });
  check('expired media reported, not silently dropped', () => {
    const m = chat1.messages.find((x) => x.key === 'ID50');
    assert.equal(m.media.status, 'failed');
    assert.match(m.media.error, /süresi dolmuş/);
    assert.match(html1, /indirilemedi: Medya WhatsApp sunucusunda artık yok/);
  });
  check('HTML escapes message text and keeps links intact', () => {
    assert.ok(!html1.includes('<script>alert(1)</script>'));
    assert.ok(html1.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html1.includes('<b>kalın</b>') && html1.includes('<i>italik</i>'));
    assert.ok(html1.includes('href="https://example.com/a_b_c?x=1&amp;y=2"'));
  });
  check('HTML reply links to the quoted message anchor', () => {
    assert.ok(html1.includes('href="#m-ID19"') && html1.includes('id="m-ID19"'));
  });
  // File.text() strips the BOM while decoding; the raw bytes are checked in the ZIP run.
  check('CSV uses ; delimiter, formula guard, quoted multi-line text', () => {
    assert.ok(csv1.split('\r\n')[0].startsWith('tarih;saat;iso_zaman;gonderen'));
    assert.ok(csv1.includes(";'=SUM(A1:A9);"));
    assert.ok(csv1.includes('"Satır 1\nSatır 2\nSatır 3"'));
  });
  check('TXT uses WhatsApp-style lines and my push name', () => {
    assert.match(txt1, /^\[01\.01\.2026 09:00:00\] Murat Yaşlıoğlu: Mesaj 0$/m);
    assert.match(txt1, /\] Ayşe Yılmaz: <ekli: media\/.+\.jpg> Tatil 🌴$/m);
  });
  check('location, vcard, revoked and forwarded/starred described', () => {
    const by = (k) => chat1.messages.find((m) => m.key === k);
    assert.equal(by('ID30').text, 'Sultanahmet — 41.0082, 28.9784');
    assert.equal(by('ID35').text, 'Ali Veli');
    assert.match(by('ID15').text, /silindi/);
    assert.equal(by('ID225').forwarded, true);
    assert.equal(by('ID225').starred, true);
  });
  check('group: LID sender resolved to phone, participants, system event', () => {
    const m = chat2.messages.find((x) => x.key === 'ID1001');
    assert.equal(m.sender, 'Mehmet');
    assert.equal(m.senderPhone, '905551234567');
    assert.equal(chat2.chat.participants.length, 3);
    assert.equal(chat2.chat.participants.find((p) => p.phone === '905551234567').admin, true);
    assert.equal(chat2.messages[0].text, 'ℹ️ Mehmet +905441112233 kişisini ekledi');
    assert.equal(chat2.messages.find((x) => x.key === 'ID1004').media.status, 'ok');
  });
  check('chat with no loaded messages is opened and exported', () => {
    assert.equal(chat3.messageCount, 3);
    assert.ok(Object.keys(files).some((p) => p === `${R}/Boş Sohbet test/sohbet.html`));
  });
  check('index page links every chat', () => {
    const index = f('index.html');
    for (const folder of ['Ay%C5%9Fe%20Y%C4%B1lmaz', 'Proje%20Ekibi', 'Bo%C5%9F%20Sohbet%20test']) {
      assert.ok(index.includes(`href="${folder}/sohbet.html"`), folder);
    }
  });

  // ---- Run 2: ZIP output, one chat, date range 10–12 Jan 2026 ----
  await page.click('text=Temizle');
  await page.fill('#wat-root input[type="search"]', 'ayşe');
  await page.click('text=Görünenleri seç');
  await page.check('#wat-root input[name="output"][value="zip"]');
  await page.fill('#wat-root input[type="date"] >> nth=0', '2026-01-10');
  await page.fill('#wat-root input[type="date"] >> nth=1', '2026-01-12');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Dışa aktarmayı başlat')]);
  const zipPath = path.join(workDir, download.suggestedFilename());
  await download.saveAs(zipPath);
  const listing = JSON.parse(
    execFileSync('python3', ['-I', '-c', `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
data = json.loads(z.read([n for n in z.namelist() if n.endswith('Ayşe Yılmaz/mesajlar.json')][0]))
csv = z.read([n for n in z.namelist() if n.endswith('Ayşe Yılmaz/mesajlar.csv')][0])
print(json.dumps({"bad": bad, "names": z.namelist(), "count": data["messageCount"], "bom": csv[:3] == b"\\xef\\xbb\\xbf",
                  "first": data["messages"][0]["t"], "last": data["messages"][-1]["t"]}))
`, zipPath], { encoding: 'utf8' }),
  );
  const from = new Date(2026, 0, 10).getTime() / 1000;
  const to = new Date(2026, 0, 13).getTime() / 1000;
  const start = new Date(2026, 0, 1, 9).getTime() / 1000;
  const expected = [...Array(230).keys()].filter((n) => n !== 45 && start + n * 10800 >= from && start + n * 10800 < to).length;
  check('ZIP passes CRC check and stores UTF-8 names', () => {
    assert.equal(listing.bad, null);
    assert.ok(listing.names.some((n) => n.includes('/Ayşe Yılmaz/sohbet.html')));
    assert.ok(listing.names.some((n) => n.endsWith('/disa-aktarim.json')));
  });
  check('CSV bytes start with the UTF-8 BOM (Excel)', () => assert.equal(listing.bom, true));
  check(`date range keeps only 10–12 Jan (${expected} messages)`, () => {
    assert.equal(listing.count, expected);
    assert.ok(listing.first >= from && listing.last < to);
  });

  check('no uncaught page errors', () => assert.deepEqual(pageErrors, []));
  await page.screenshot({ path: path.join(workDir, 'panel.png') });
  await context.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
