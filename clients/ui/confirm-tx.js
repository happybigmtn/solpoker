const puppeteer = require('puppeteer-core');

async function confirm() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222'
  });

  const pages = await browser.pages();

  // Find the Phantom wallet popup
  const walletPage = pages.find(p => p.url().includes('chrome-extension'));

  if (!walletPage) {
    console.log('No Phantom wallet popup found');
    console.log('Available pages:');
    for (const p of pages) {
      console.log('  -', p.url());
    }
    await browser.disconnect();
    return;
  }

  console.log('Found Phantom popup:', walletPage.url());

  // Look for the "Confirm anyway" button and click it
  const clicked = await walletPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const confirmBtn = buttons.find(b =>
      b.textContent?.includes('Confirm anyway') ||
      b.textContent?.includes('Confirm')
    );
    if (confirmBtn) {
      console.log('Found button:', confirmBtn.textContent);
      confirmBtn.click();
      return confirmBtn.textContent;
    }
    return null;
  });

  if (clicked) {
    console.log('Clicked button:', clicked);
  } else {
    console.log('Could not find Confirm button');
    const content = await walletPage.evaluate(() => document.body.innerText);
    console.log('Page content:', content);
  }

  // Wait a moment
  await new Promise(r => setTimeout(r, 2000));

  // Now check the poker page for results
  const pokerPage = pages.find(p => p.url().includes('poker.regenesis.dev'));
  if (pokerPage) {
    // Set up console listener
    pokerPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[joinTable]') || text.includes('error') || text.includes('Error')) {
        console.log(`[BROWSER] ${text}`);
      }
    });

    // Wait for transaction result
    console.log('\nWaiting for transaction result...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const state = await pokerPage.evaluate(() => {
        const bodyText = document.body.innerText;
        return {
          hasJoining: bodyText.includes('Joining'),
          hasSubmitting: bodyText.includes('Submitting'),
          hasFailed: bodyText.includes('failed') || bodyText.includes('Failed'),
          hasConfirmed: bodyText.includes('confirmed') || bodyText.includes('Confirmed'),
          excerpt: bodyText.substring(0, 800)
        };
      });

      if (state.hasFailed) {
        console.log('\n=== TRANSACTION FAILED ===');
        console.log(state.excerpt);
        break;
      }

      if (state.hasConfirmed) {
        console.log('\n=== TRANSACTION CONFIRMED ===');
        console.log(state.excerpt);
        break;
      }

      if (!state.hasJoining && !state.hasSubmitting && i > 3) {
        console.log('\n=== Transaction state changed ===');
        console.log(state.excerpt);
        break;
      }

      if (i % 5 === 0) {
        console.log(`[${i}s] Status: Joining=${state.hasJoining}, Submitting=${state.hasSubmitting}`);
      }
    }
  }

  await browser.disconnect();
}

confirm().catch(console.error);
