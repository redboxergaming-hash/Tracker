import fs from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromiumLaunchOptions, WEBKIT_IOS_DEVICE } from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const artifactRoot = path.join(repoRoot, 'artifacts', 'ui-smoke');
const screenshotPath = path.join(artifactRoot, 'screenshot.png');
const sanityPath = path.join(artifactRoot, 'sanity.png');
const diagnosticsPath = path.join(artifactRoot, 'diagnostics.json');
const serverLogPath = path.join(artifactRoot, 'server.log');
const tracePath = path.join(artifactRoot, 'trace.zip');
const port = Number(process.env.UI_SMOKE_PORT || 4173);
const hosts = ['127.0.0.1', 'localhost'];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error) {
  return String(error?.stack || error?.message || error || '');
}

function isMissingPlaywrightError(error) {
  const text = errorText(error);
  return error?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package 'playwright'/i.test(text);
}

function isMissingBrowserBinaryError(error) {
  const text = errorText(error);
  return /Executable doesn't exist|please run the following command to download new browsers|browserType\.launch: Executable|browser not found|No such file or directory.*playwright/i.test(text);
}

function classifyFailure(error) {
  const text = errorText(error);
  if (isMissingBrowserBinaryError(error)) return 'binary-installation-failure';
  if (/ERR_EMPTY_RESPONSE|ERR_CONNECTION|ECONNREFUSED|Navigation timeout/i.test(text)) return 'connectivity-failure';
  if (/TargetClosedError|BrowserType\.launch|crash|SIGSEGV|Connection terminated unexpectedly/i.test(text)) return 'browser-runtime-failure';
  return 'application-failure';
}

function isBlockedDownloadError(text) {
  const output = String(text || '').toLowerCase();
  return (
    output.includes('403')
    || output.includes('domain forbidden')
    || output.includes('failed to download')
    || output.includes('download failed')
    || output.includes('eai_again')
    || output.includes('econnreset')
    || output.includes('enotfound')
    || output.includes('cdn')
    || output.includes('network')
  );
}

function isHttpReachabilityError(error) {
  const text = errorText(error);
  return /ERR_EMPTY_RESPONSE|ERR_CONNECTION|ECONNREFUSED|Connection terminated unexpectedly|Navigation timeout/i.test(text);
}

async function httpHead(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

async function waitForServer(host, timeoutMs, diagnostics) {
  const started = Date.now();
  const url = `http://${host}:${port}/index.html`;
  while (Date.now() - started < timeoutMs) {
    const result = await httpHead(url);
    diagnostics.serverHealthChecks.push({ ts: nowIso(), host, url, ...result });
    if (result.ok) return true;
    await sleep(200);
  }
  return false;
}

async function startServer(diagnostics) {
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const chunks = [];
  server.stdout.on('data', (d) => chunks.push(`[stdout] ${String(d)}`));
  server.stderr.on('data', (d) => chunks.push(`[stderr] ${String(d)}`));

  diagnostics.server = {
    cwd: repoRoot,
    pid: server.pid,
    indexExists: await fs.access(path.join(repoRoot, 'index.html')).then(() => true).catch(() => false)
  };

  let selectedHost = null;
  for (const host of hosts) {
    const ok = await waitForServer(host, 12000, diagnostics);
    if (ok && !selectedHost) selectedHost = host;
  }

  diagnostics.server.selectedHost = selectedHost;

  async function stop() {
    server.kill('SIGTERM');
    await sleep(200);
    await fs.writeFile(serverLogPath, chunks.join(''), 'utf8');
  }

  return { server, selectedHost, stop };
}

function attachPageDiagnostics(page, diagnostics) {
  page.on('console', (msg) => {
    diagnostics.console.push({ ts: nowIso(), type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push({ ts: nowIso(), error: errorText(error) });
  });
  page.on('requestfailed', (req) => {
    diagnostics.requestFailed.push({
      ts: nowIso(),
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || 'unknown'
    });
  });
}

async function gotoWithRetry(page, url, diagnostics, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      diagnostics.navigationAttempts.push({ ts: nowIso(), url, attempt: i + 1 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (error) {
      lastError = error;
      diagnostics.navigationErrors.push({ ts: nowIso(), attempt: i + 1, error: errorText(error) });
      await sleep(300 * 2 ** i);
    }
  }
  throw lastError;
}

async function tryHttpStrategy(page, baseUrl, diagnostics) {
  diagnostics.navigationStrategyAttempts.push({ ts: nowIso(), strategy: 'HTTP', target: baseUrl });
  await gotoWithRetry(page, baseUrl, diagnostics, 3);
  diagnostics.navigationStrategyUsed = 'HTTP';
}

async function tryFileStrategy(page, diagnostics) {
  const fileUrl = pathToFileURL(path.join(repoRoot, 'index.html')).href;
  diagnostics.navigationStrategyAttempts.push({ ts: nowIso(), strategy: 'FILE', target: fileUrl });
  await gotoWithRetry(page, fileUrl, diagnostics, 2);
  diagnostics.navigationStrategyUsed = 'FILE';
}

function buildInlineHtml(indexHtml) {
  const baseHref = `${pathToFileURL(repoRoot).href.replace(/\/$/, '')}/`;
  const withBase = indexHtml.includes('<head>')
    ? indexHtml.replace('<head>', `<head><base href="${baseHref}">`)
    : `<base href="${baseHref}">${indexHtml}`;
  return withBase;
}

async function tryInlineStrategy(page, diagnostics) {
  const indexHtmlPath = path.join(repoRoot, 'index.html');
  const html = await fs.readFile(indexHtmlPath, 'utf8');
  const inlineHtml = buildInlineHtml(html);
  diagnostics.navigationStrategyAttempts.push({ ts: nowIso(), strategy: 'INLINE', target: indexHtmlPath });
  await page.setContent(inlineHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });
  diagnostics.navigationStrategyUsed = 'INLINE';
}

async function navigateWithFallback(page, baseUrl, diagnostics) {
  const allowHttp = process.env.UI_SMOKE_ALLOW_HTTP === '1';
  diagnostics.navigationHttpOptIn = allowHttp;

  if (allowHttp && baseUrl) {
    try {
      await tryHttpStrategy(page, baseUrl, diagnostics);
      return;
    } catch (error) {
      diagnostics.navigationFallbacks.push({
        ts: nowIso(),
        from: 'HTTP',
        to: 'FILE',
        reason: errorText(error)
      });
      if (!isHttpReachabilityError(error)) throw error;
    }
  } else {
    diagnostics.navigationFallbacks.push({
      ts: nowIso(),
      from: 'HTTP',
      to: 'FILE',
      reason: 'HTTP strategy disabled unless UI_SMOKE_ALLOW_HTTP=1 (default is file-safe mode for remote browser sandboxes).'
    });
  }

  try {
    await tryFileStrategy(page, diagnostics);
  } catch (error) {
    diagnostics.navigationFallbacks.push({
      ts: nowIso(),
      from: 'FILE',
      to: 'INLINE',
      reason: errorText(error)
    });
    await tryInlineStrategy(page, diagnostics);
  }
}

async function resolvePlaywright(diagnostics) {
  let pkgVersion = 'unknown';
  try {
    const pkg = await import('playwright/package.json', { with: { type: 'json' } });
    pkgVersion = pkg?.default?.version || 'unknown';
  } catch {
    // ignored
  }

  let playwright;
  try {
    playwright = await import('playwright');
  } catch (error) {
    if (isMissingPlaywrightError(error)) {
      diagnostics.classification = 'binary-installation-failure';
      diagnostics.result = 'playwright-missing';
      diagnostics.instructions = [
        'Playwright package is missing in this environment.',
        'Run locally: npm install',
        'Then: npx playwright install',
        'Then: npm run ui:smoke'
      ];
      return null;
    }
    throw error;
  }

  diagnostics.playwrightVersion = pkgVersion;
  return playwright;
}

async function canAccessFile(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectBrowserExecutables(playwright, diagnostics) {
  const targets = process.env.CI ? ['chromium'] : ['chromium', 'webkit'];
  const checks = [];

  for (const name of targets) {
    const browserType = playwright[name];
    if (!browserType) continue;
    const executablePath = browserType.executablePath();
    const exists = await canAccessFile(executablePath);
    checks.push({ browser: name, executablePath, exists });
  }

  diagnostics.binaryChecks = checks;
  return checks.every((row) => row.exists);
}

function runPlaywrightInstall(diagnostics, withDeps = false) {
  const args = ['playwright', 'install'];
  if (withDeps) args.push('--with-deps');
  if (process.env.CI) args.push('chromium');
  else args.push('chromium', 'webkit');

  const result = spawnSync('npx', args, { cwd: repoRoot, encoding: 'utf8', shell: true });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;

  diagnostics.installAttempt = {
    command: `npx ${args.join(' ')}`,
    status: result.status,
    blocked: isBlockedDownloadError(combined)
  };

  if (result.status !== 0 && diagnostics.installAttempt.blocked) {
    diagnostics.installAttempt.note = 'Browser binary download blocked by environment (CDN restriction).';
  }

  return { ok: result.status === 0, blocked: diagnostics.installAttempt.blocked };
}

function summarizeMissingBrowsers(diagnostics) {
  return (diagnostics.binaryChecks || []).filter((row) => !row.exists).map((row) => ({
    browser: row.browser,
    executablePath: row.executablePath
  }));
}

async function launchBrowser(playwright, diagnostics) {
  const candidates = process.env.CI
    ? [
      {
        name: 'chromium',
        launch: () => playwright.chromium.launch({ ...chromiumLaunchOptions(), args: ['--no-sandbox', '--disable-setuid-sandbox', ...((chromiumLaunchOptions().args || []))] }),
        context: () => ({ viewport: { width: 390, height: 844 } })
      }
    ]
    : [
    {
      name: 'chromium',
      launch: () => playwright.chromium.launch({ ...chromiumLaunchOptions(), args: ['--no-sandbox', '--disable-setuid-sandbox', ...((chromiumLaunchOptions().args || []))] }),
      context: () => ({ viewport: { width: 390, height: 844 } })
    },
    {
      name: 'webkit',
      launch: () => playwright.webkit.launch({ headless: true }),
      context: () => WEBKIT_IOS_DEVICE
    }
  ];

  for (const candidate of candidates) {
    try {
      diagnostics.browserAttempts.push({ ts: nowIso(), browser: candidate.name });
      const browser = await candidate.launch();
      return { browser, candidate };
    } catch (error) {
      diagnostics.browserLaunchErrors.push({ ts: nowIso(), browser: candidate.name, error: errorText(error) });
      if (isMissingBrowserBinaryError(error)) {
        diagnostics.classification = 'binary-installation-failure';
        diagnostics.result = 'browser-binaries-missing';
      }
    }
  }
  return null;
}

async function runSanity(browser, contextOptions, diagnostics) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.setContent('<main><h1>ok</h1><p>ui-smoke sanity</p></main>');
  await page.screenshot({ path: sanityPath });
  diagnostics.sanityScreenshot = sanityPath;
  await context.close();
}

async function runAppScreenshot(browser, contextOptions, baseUrl, diagnostics) {
  const context = await browser.newContext(contextOptions);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  attachPageDiagnostics(page, diagnostics);

  try {
    await navigateWithFallback(page, baseUrl, diagnostics);
    await page.waitForTimeout(500);
    await page.click('button[data-route="add"]');
    await page.waitForTimeout(700);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    diagnostics.screenshot = screenshotPath;
  } catch (error) {
    diagnostics.error = errorText(error);
    diagnostics.classification = classifyFailure(error);
    throw error;
  } finally {
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    diagnostics.trace = tracePath;
    await context.close().catch(() => {});
  }
}

async function writeDiagnostics(diagnostics) {
  await fs.writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), 'utf8');
}

async function main() {
  await fs.mkdir(artifactRoot, { recursive: true });

  const diagnostics = {
    startedAt: nowIso(),
    cwd: repoRoot,
    screenshotTarget: screenshotPath,
    console: [],
    pageErrors: [],
    requestFailed: [],
    serverHealthChecks: [],
    navigationAttempts: [],
    navigationErrors: [],
    navigationStrategyAttempts: [],
    navigationFallbacks: [],
    navigationStrategyUsed: null,
    browserAttempts: [],
    browserLaunchErrors: [],
    classification: 'unknown',
    result: 'running',
    ci: process.env.CI === 'true',
    strict: process.env.PLAYWRIGHT_STRICT === '1',
    envSkipBrowserDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === 'true'
  };

  let finalLine = null;
  const conclude = async (status, classification, details = {}, exit = 0) => {
    diagnostics.result = status;
    diagnostics.classification = classification;
    diagnostics.finishedAt = nowIso();
    await writeDiagnostics(diagnostics);
    finalLine = {
      ui_smoke: status,
      classification,
      action: 'npx playwright install',
      details
    };
    console.log(JSON.stringify(finalLine));
    process.exitCode = exit;
  };

  let exitCode = 0;
  const playwright = await resolvePlaywright(diagnostics);
  if (!playwright) {
    await conclude('failed', 'installable-missing', {
      message: 'Playwright package missing.',
      fix: 'npm install && npx playwright install && npm run ui:smoke'
    }, 1);
    return;
  }

  if (diagnostics.envSkipBrowserDownload) {
    diagnostics.instructions = [
      'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set; skipping screenshot execution by policy.',
      'Unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD to run screenshot capture.',
      'Run: npx playwright install && npm run ui:smoke'
    ];
    await conclude('skipped', 'binary-installation-blocked', {
      reason: 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
      attempted: diagnostics.installAttempt || null,
      missingBrowsers: summarizeMissingBrowsers(diagnostics)
    }, diagnostics.strict ? 1 : 0);
    return;
  }

  let browsersReady = await detectBrowserExecutables(playwright, diagnostics);
  if (!browsersReady) {
    console.warn('Playwright browsers not installed. Run: npx playwright install');
    const install = runPlaywrightInstall(diagnostics, process.env.CI === 'true');
    if (!install.ok) {
      diagnostics.instructions = [
        'Playwright browsers not installed. Run: npx playwright install',
        install.blocked ? 'Browser binary download blocked by environment (CDN restriction).' : 'Browser install command failed for a non-network reason.'
      ];
      if (install.blocked) {
        console.error('Browser binary download blocked by environment (CDN restriction).');
        await conclude('skipped', 'binary-installation-blocked', {
          attempted: diagnostics.installAttempt,
          missingBrowsers: summarizeMissingBrowsers(diagnostics),
          strict: diagnostics.strict,
          ci: diagnostics.ci
        }, diagnostics.strict ? 1 : 0);
        return;
      }
      if (diagnostics.ci && !diagnostics.strict) {
        await conclude('skipped', 'binary-installation-blocked', {
          attempted: diagnostics.installAttempt,
          missingBrowsers: summarizeMissingBrowsers(diagnostics),
          reason: 'ci-default-warn-only'
        }, 0);
        return;
      }
      await conclude('failed', 'installable-missing', {
        attempted: diagnostics.installAttempt,
        missingBrowsers: summarizeMissingBrowsers(diagnostics)
      }, 1);
      return;
    }

    browsersReady = await detectBrowserExecutables(playwright, diagnostics);
    if (!browsersReady) {
      diagnostics.instructions = ['Playwright browsers not installed. Run: npx playwright install'];
      if (diagnostics.ci && !diagnostics.strict) {
        await conclude('skipped', 'binary-installation-blocked', {
          missingBrowsers: summarizeMissingBrowsers(diagnostics),
          reason: 'ci-default-warn-only-after-install'
        }, 0);
        return;
      }
      await conclude('failed', 'installable-missing', {
        missingBrowsers: summarizeMissingBrowsers(diagnostics)
      }, 1);
      return;
    }
  }

  const serverCtx = await startServer(diagnostics);

  try {
    if (!serverCtx.selectedHost) {
      diagnostics.classification = 'connectivity-failure';
      diagnostics.result = 'failed';
      throw new Error('Server did not become reachable on 127.0.0.1 or localhost.');
    }

    const browserCtx = await launchBrowser(playwright, diagnostics);
    if (!browserCtx) {
      diagnostics.result = 'skipped';
      diagnostics.instructions = [
        'Browser launch failed in this environment.',
        'If this is a restricted sandbox, run locally:',
        '  npm install',
        '  npx playwright install',
        '  npm run ui:smoke',
        'Expected screenshot path: artifacts/ui-smoke/screenshot.png'
      ];
      await conclude('failed', 'test-failure', {
        message: 'Browser failed to launch despite executable checks.',
        browserLaunchErrors: diagnostics.browserLaunchErrors
      }, 1);
      return;
    }

    const { browser, candidate } = browserCtx;
    diagnostics.browserUsed = candidate.name;

    try {
      const contextOptions = candidate.context();
      await runSanity(browser, contextOptions, diagnostics);
      const baseUrl = `http://${serverCtx.selectedHost}:${port}/index.html`;
      diagnostics.baseUrl = baseUrl;
      await runAppScreenshot(browser, contextOptions, baseUrl, diagnostics);
      console.log(`Screenshot created: ${screenshotPath}`);
      await conclude('passed', 'success', {
        screenshot: screenshotPath,
        sanity: sanityPath,
        trace: tracePath,
        strategy: diagnostics.navigationStrategyUsed
      }, 0);
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (error) {
    diagnostics.result = diagnostics.result === 'skipped' ? 'skipped' : 'failed';
    diagnostics.error = diagnostics.error || errorText(error);
    diagnostics.classification = diagnostics.classification === 'unknown' ? classifyFailure(error) : diagnostics.classification;

    if (diagnostics.classification === 'binary-installation-failure' || diagnostics.classification === 'browser-runtime-failure') {
      diagnostics.result = 'skipped';
      console.warn(`UI smoke best-effort skip: ${diagnostics.classification}`);
      console.warn('To force screenshot locally: npm install && npx playwright install && npm run ui:smoke');
      await conclude('skipped', 'binary-installation-blocked', {
        reason: diagnostics.classification,
        error: diagnostics.error,
        strict: diagnostics.strict
      }, diagnostics.strict ? 1 : 0);
    } else {
      console.error(`UI smoke failed: ${diagnostics.classification}`);
      console.error(errorText(error));
      await conclude('failed', 'test-failure', {
        error: diagnostics.error || errorText(error),
        classification: diagnostics.classification
      }, 1);
    }
  } finally {
    await serverCtx.stop();
    if (!finalLine) {
      await conclude(exitCode === 0 ? 'passed' : 'failed', exitCode === 0 ? 'success' : 'test-failure', {
        note: 'finalize-without-early-conclusion'
      }, exitCode);
    }
  }
}

await main();
