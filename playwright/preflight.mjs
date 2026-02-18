import process from 'node:process';
import { chromiumLaunchOptions, WEBKIT_IOS_DEVICE } from './config.mjs';

function textOf(error) {
  return String(error?.stack || error?.message || error || '');
}

export function looksLikeMissingPlaywright(error) {
  const text = textOf(error);
  return error?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package 'playwright'/i.test(text);
}

export function looksLikeMissingBrowserBinary(error) {
  const text = textOf(error);
  return /Executable doesn't exist|browserType\.launch: Executable|please run the following command to download new browsers|browser not found|failed to launch browser process/i.test(text);
}

export function classifyBrowserLaunchError(error) {
  if (looksLikeMissingBrowserBinary(error)) return 'binary-installation-failure';
  const text = textOf(error);
  if (/ECONNREFUSED|ERR_CONNECTION|ERR_EMPTY_RESPONSE|Navigation timeout/i.test(text)) return 'connectivity-failure';
  if (/TargetClosedError|has been closed|crash|SIGSEGV/i.test(text)) return 'browser-runtime-failure';
  return 'unknown-browser-failure';
}

async function canLaunch(name, browserType, options) {
  const browser = await browserType.launch(options);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await browser.close();
  return { name, ok: true };
}

export async function playwrightPreflight() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (error) {
    if (looksLikeMissingPlaywright(error)) {
      return {
        ok: false,
        reason: 'playwright-missing',
        classification: 'binary-installation-failure',
        message: 'Playwright is not installed. Run: npm i && npx playwright install'
      };
    }
    throw error;
  }

  const packageVersion = playwright?.default?.devices ? (await import('playwright/package.json', { with: { type: 'json' } }).catch(() => null))?.default?.version : null;
  const { chromium, webkit } = playwright;
  try {
    await canLaunch('webkit', webkit, { headless: true });
    await canLaunch('chromium', chromium, chromiumLaunchOptions());
    return {
      ok: true,
      reason: 'ready',
      classification: 'ready',
      playwrightVersion: packageVersion || 'unknown',
      webkitDevice: WEBKIT_IOS_DEVICE.viewport
    };
  } catch (error) {
    if (looksLikeMissingBrowserBinary(error)) {
      return {
        ok: false,
        reason: 'browser-binaries-missing',
        classification: 'binary-installation-failure',
        playwrightVersion: packageVersion || 'unknown',
        message:
          'Playwright is installed but browser binaries are missing. In restricted environments (CDN 403), installs may fail. Run this locally on your machine: npx playwright install. WebKit is authoritative for iPhone/Safari behavior.'
      };
    }
    return {
      ok: false,
      reason: 'browser-launch-failed',
      classification: classifyBrowserLaunchError(error),
      playwrightVersion: packageVersion || 'unknown',
      message: textOf(error)
    };
  }
}

export function installProcessDiagnostics(logger = console) {
  const log = (label, err) => logger.error(`[process:${label}]`, textOf(err));
  process.on('unhandledRejection', (err) => log('unhandledRejection', err));
  process.on('uncaughtException', (err) => log('uncaughtException', err));
}
