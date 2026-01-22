const puppeteer = require('puppeteer-core');

async function test() {
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

  // Set up console logging BEFORE refresh
  pokerPage.on('console', msg => {
    const text = msg.text();
    console.log(`[${msg.type()}] ${text.substring(0, 1000)}`);
  });

  pokerPage.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message);
  });

  // Force refresh with cache bust
  console.log('=== Hard refreshing page ===');
  await pokerPage.evaluate(() => location.reload(true));
  await new Promise(r => setTimeout(r, 5000));

  console.log('\n=== Clicking Join Table ===');
  const clicked = await pokerPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const joinBtn = buttons.find(b => b.textContent?.includes('Join Table'));
    if (joinBtn) {
      joinBtn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log('Join Table button not found');
    await browser.disconnect();
    return;
  }

  console.log('Clicked! Waiting for wallet popup...');
  await new Promise(r => setTimeout(r, 3000));

  // Find and click confirm in wallet
  const allPages = await browser.pages();
  const walletPage = allPages.find(p => p.url().includes('chrome-extension'));

  if (walletPage) {
    console.log('\n=== Clicking Confirm in wallet ===');
    await walletPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const confirmBtn = buttons.find(b => b.textContent?.includes('Confirm'));
      if (confirmBtn) confirmBtn.click();
    });
  }

  // Wait for result with console capture
  console.log('\n=== Waiting for transaction result ===');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));

    const state = await pokerPage.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasFailed: bodyText.includes('failed') || bodyText.includes('Failed'),
        hasJoining: bodyText.includes('Joining'),
      };
    });

    if (state.hasFailed) {
      console.log('\n=== FAILED after ' + i + 's ===');
      break;
    }

    if (!state.hasJoining && i > 5) {
      console.log('\n=== Completed after ' + i + 's ===');
      break;
    }
  }

  await browser.disconnect();
}

test().catch(console.error);
