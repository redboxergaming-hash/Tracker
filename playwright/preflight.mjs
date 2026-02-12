import { chromiumLaunchOptions } from './config.mjs';

function looksLikeMissingPlaywright(error) {
  const text = String(error?.stack || error?.message || error || '');
  return error?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package 'playwright'/i.test(text);
}

function looksLikeMissingBrowserBinary(error) {
  const text = String(error?.stack || error?.message || error || '');
  return /Executable doesn't exist|browserType\.launch: Executable|please run the following command to download new browsers|browser not found|failed to launch browser process/i.test(text);
}

async function canLaunch(name, browserType, options) {
  const browser = await browserType.launch(options);
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
        message: 'Playwright is not installed. Run: npm i && npx playwright install'
      };
    }
    throw error;
  }

  const { chromium, webkit } = playwright;
  try {
    await canLaunch('webkit', webkit, { headless: true });
    await canLaunch('chromium', chromium, chromiumLaunchOptions());
    return { ok: true, reason: 'ready' };
  } catch (error) {
    if (looksLikeMissingBrowserBinary(error)) {
      return {
        ok: false,
        reason: 'browser-binaries-missing',
        message:
          'Playwright is installed but browser binaries are missing. In restricted environments (CDN 403), installs may fail. Run this locally on your machine: npx playwright install. WebKit is authoritative for iPhone/Safari behavior.'
      };
    }
    throw error;
  }
}
