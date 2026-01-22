const puppeteer = require('puppeteer-core');

async function debug() {
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

  // Navigate to a table with players
  console.log('Navigating to table with waiting status...');
  await pokerPage.goto('https://poker.regenesis.dev/table/1768850505602', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // Listen for console output
  pokerPage.on('console', msg => {
    console.log('BROWSER CONSOLE:', msg.type(), msg.text().substring(0, 200));
  });

  // Check page state before clicking
  let pageState = await pokerPage.evaluate(() => ({
    url: window.location.pathname,
    bodyText: document.body.innerText.substring(0, 500)
  }));
  console.log('\n=== BEFORE JOIN ===');
  console.log(pageState.bodyText);

  // Try to open command palette with Cmd+K
  console.log('\nPressing Cmd+K to open command palette...');
  await pokerPage.keyboard.down('Meta');
  await pokerPage.keyboard.press('k');
  await pokerPage.keyboard.up('Meta');
  await new Promise(r => setTimeout(r, 1000));

  // Check if command palette opened
  let afterPalette = await pokerPage.evaluate(() => {
    // Look for command palette dialog
    const dialog = document.querySelector('[role="dialog"]');
    const listbox = document.querySelector('[role="listbox"]');
    return {
      hasDialog: !!dialog,
      hasListbox: !!listbox,
      bodyText: document.body.innerText.substring(0, 800)
    };
  });

  console.log('\n=== AFTER CMD+K ===');
  console.log('Has dialog:', afterPalette.hasDialog);
  console.log('Has listbox:', afterPalette.hasListbox);
  console.log('Body:', afterPalette.bodyText);

  // If no command palette, try Ctrl+K
  if (!afterPalette.hasDialog && !afterPalette.hasListbox) {
    console.log('\nTrying Ctrl+K...');
    await pokerPage.keyboard.down('Control');
    await pokerPage.keyboard.press('k');
    await pokerPage.keyboard.up('Control');
    await new Promise(r => setTimeout(r, 1000));

    afterPalette = await pokerPage.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const listbox = document.querySelector('[role="listbox"]');
      return {
        hasDialog: !!dialog,
        hasListbox: !!listbox,
        bodyText: document.body.innerText.substring(0, 800)
      };
    });
    console.log('After Ctrl+K - Has dialog:', afterPalette.hasDialog);
  }

  await browser.disconnect();
}

debug().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
