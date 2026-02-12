export function isCiLikeEnv() {
  return process.env.CI === 'true' || process.env.CONTAINER === 'true' || process.platform === 'linux';
}

export function chromiumLaunchOptions() {
  // Harden Chromium launch in container/CI where sandbox/dev-shm issues can cause process crashes.
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  return {
    headless: true,
    chromiumSandbox: false,
    args: isCiLikeEnv() ? args : []
  };
}

export const WEBKIT_IOS_DEVICE = {
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
};
