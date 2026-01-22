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

  // Capture console messages
  const consoleLogs = [];
  pokerPage.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  // Refresh and wait for logs
  console.log('Refreshing page to capture fresh logs...');
  await pokerPage.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // Check current page state
  const state = await pokerPage.evaluate(() => {
    return {
      bodyText: document.body.innerText.substring(0, 2000),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim())
    };
  });

  console.log('\n=== Page State ===');
  console.log(state.bodyText);
  console.log('\nButtons:', state.buttons);

  console.log('\n=== Console Logs ===');
  consoleLogs.forEach(log => {
    if (log.type === 'error' || log.text.toLowerCase().includes('error') || log.text.toLowerCase().includes('fail')) {
      console.log(`[${log.type}] ${log.text}`);
    }
  });

  // Now try clicking Join again and capture the error
  console.log('\n=== Attempting to click Join Table ===');

  // Find Join Table button by evaluating in page context
  const clicked = await pokerPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const joinBtn = buttons.find(b => b.textContent?.includes('Join Table'));
    if (joinBtn) {
      joinBtn.click();
      return true;
    }
    return false;
  });

  if (clicked) {
    console.log('Clicked Join Table button');

    // Wait for transaction attempt
    await new Promise(r => setTimeout(r, 8000));

    console.log('\n=== Logs after clicking Join ===');
    consoleLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text.substring(0, 500)}`);
    });

    // Check page state after click
    const afterState = await pokerPage.evaluate(() => {
      return document.body.innerText.substring(0, 1500);
    });
    console.log('\n=== Page after click ===');
    console.log(afterState);
  } else {
    console.log('Join Table button not found');
    console.log('Available buttons:', state.buttons);
  }

  await browser.disconnect();
}

check().catch(console.error);
