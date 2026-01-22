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

  // Capture ALL console messages
  const logs = [];
  pokerPage.on('console', msg => {
    const text = msg.text();
    logs.push({ type: msg.type(), text });
    // Print joinTable errors immediately
    if (text.includes('[joinTable]')) {
      console.log(`[CONSOLE] ${text}`);
    }
  });

  pokerPage.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message);
  });

  // Refresh the page with cache busting
  console.log('Refreshing page...');
  await pokerPage.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3000));

  // Click Join Table
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
    console.log('Clicked Join Table, waiting for result...');

    // Wait for the transaction to complete (up to 60 seconds)
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const state = await pokerPage.evaluate(() => {
        const bodyText = document.body.innerText;
        return {
          hasJoining: bodyText.includes('Joining'),
          hasSubmitting: bodyText.includes('Submitting'),
          hasFailed: bodyText.includes('failed') || bodyText.includes('Failed'),
        };
      });

      if (state.hasFailed) {
        console.log('\\n=== TRANSACTION FAILED ===');
        break;
      }

      if (!state.hasJoining && !state.hasSubmitting && i > 5) {
        console.log('\\n=== Transaction completed ===');
        break;
      }

      if (i % 10 === 0) {
        console.log(`[${i}s] Waiting... Joining=${state.hasJoining}, Submitting=${state.hasSubmitting}`);
      }
    }

    // Print all joinTable logs
    console.log('\\n=== All [joinTable] logs ===');
    logs.filter(l => l.text.includes('[joinTable]') || l.text.includes('error') || l.text.includes('Error'))
      .forEach(l => console.log(`[${l.type}] ${l.text}`));
  } else {
    console.log('Join Table button not found');
  }

  await browser.disconnect();
}

test().catch(console.error);
