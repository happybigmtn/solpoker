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

  // Capture ALL console messages
  const allLogs = [];
  pokerPage.on('console', msg => {
    const text = msg.text();
    allLogs.push({ type: msg.type(), text });
    // Print errors and transaction-related logs immediately
    if (msg.type() === 'error' || text.includes('transaction') || text.includes('Transaction') || text.includes('error') || text.includes('Error') || text.includes('fail') || text.includes('Fail')) {
      console.log(`[LIVE ${msg.type()}] ${text.substring(0, 800)}`);
    }
  });

  // Also capture page errors
  pokerPage.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message);
  });

  console.log('Monitoring page for 30 seconds...');
  console.log('Please approve the wallet transaction if prompted.\n');

  // Poll the page state
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));

    const state = await pokerPage.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasJoining: bodyText.includes('Joining'),
        hasSubmitting: bodyText.includes('Submitting'),
        hasFailed: bodyText.includes('failed') || bodyText.includes('Failed'),
        hasError: bodyText.includes('Error') || bodyText.includes('error'),
        excerpt: bodyText.substring(0, 500)
      };
    });

    if (state.hasFailed || state.hasError) {
      console.log('\n=== FAILURE DETECTED ===');
      console.log(state.excerpt);
      break;
    }

    if (!state.hasJoining && !state.hasSubmitting && i > 5) {
      console.log('\n=== Transaction seems complete ===');
      console.log(state.excerpt);
      break;
    }

    if (i % 5 === 0) {
      console.log(`[${i}s] Status: Joining=${state.hasJoining}, Submitting=${state.hasSubmitting}`);
    }
  }

  console.log('\n=== All logged messages ===');
  allLogs.forEach(log => {
    if (log.type === 'error' || log.text.includes('Error') || log.text.includes('error') || log.text.includes('fail') || log.text.includes('transaction')) {
      console.log(`[${log.type}] ${log.text.substring(0, 500)}`);
    }
  });

  await browser.disconnect();
}

check().catch(console.error);
