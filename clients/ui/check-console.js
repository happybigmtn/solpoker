const puppeteer = require('puppeteer-core');

async function check() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222'
  });

  const pages = await browser.pages();
  const pokerPage = pages.find(p => p.url().includes('poker.regenesis.dev'));

  if (!pokerPage) {
    console.log('No poker page found');
    await browser.disconnect();
    return;
  }

  // Get console logs from the page
  const logs = await pokerPage.evaluate(() => {
    // Check for any global error state
    const errorElements = document.querySelectorAll('[class*="error"], [role="alert"]');
    const errors = Array.from(errorElements).map(el => el.textContent?.trim()).filter(Boolean);

    // Look for any toast notifications
    const toasts = document.querySelectorAll('[class*="toast"], [class*="notification"]');
    const toastTexts = Array.from(toasts).map(el => el.textContent?.trim()).filter(Boolean);

    return {
      errors,
      toasts
    };
  });

  console.log('Error elements:', logs.errors);
  console.log('Toast notifications:', logs.toasts);

  // Also try to capture any network requests that might have failed
  const client = await pokerPage.createCDPSession();
  await client.send('Network.enable');

  // Check for any pending requests
  console.log('\nWaiting 3 seconds to capture any network activity...');

  const requests = [];
  client.on('Network.requestWillBeSent', (params) => {
    if (params.request.url.includes('solana') || params.request.url.includes('rpc')) {
      requests.push({ type: 'sent', url: params.request.url, method: params.request.method });
    }
  });

  client.on('Network.responseReceived', (params) => {
    if (params.response.url.includes('solana') || params.response.url.includes('rpc')) {
      requests.push({ type: 'response', url: params.response.url, status: params.response.status });
    }
  });

  await new Promise(r => setTimeout(r, 3000));

  console.log('\nRecent RPC requests:', requests.length > 0 ? requests : 'None captured');

  await browser.disconnect();
}

check().catch(console.error);
