const puppeteer = require('puppeteer-core');

async function check() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222'
  });

  const pages = await browser.pages();

  console.log('All open pages:');
  for (const page of pages) {
    const url = page.url();
    const title = await page.title().catch(() => 'Unknown');
    console.log(`  - ${title}: ${url}`);
  }

  // Check for any wallet extension popups
  const walletPages = pages.filter(p => {
    const url = p.url();
    return url.includes('phantom') ||
           url.includes('solflare') ||
           url.includes('backpack') ||
           url.includes('wallet') ||
           url.includes('approve') ||
           url.includes('chrome-extension');
  });

  if (walletPages.length > 0) {
    console.log('\nFound potential wallet pages:');
    for (const page of walletPages) {
      console.log(`  - ${page.url()}`);
      const content = await page.evaluate(() => document.body.innerText?.substring(0, 500)).catch(() => 'Could not read');
      console.log(`    Content: ${content}`);
    }
  } else {
    console.log('\nNo wallet popup pages detected');
  }

  // Check the poker page for any transaction state
  const pokerPage = pages.find(p => p.url().includes('poker.regenesis.dev'));
  if (pokerPage) {
    const state = await pokerPage.evaluate(() => {
      // Check localStorage for any transaction state
      const localStorage = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key.includes('transaction') || key.includes('pending') || key.includes('wallet')) {
          localStorage[key] = window.localStorage.getItem(key);
        }
      }

      // Check if there's any modal or dialog open
      const dialogs = document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]');
      const dialogContents = Array.from(dialogs).map(d => d.textContent?.substring(0, 200));

      return {
        localStorage,
        dialogs: dialogContents
      };
    });

    console.log('\nTransaction-related localStorage:', Object.keys(state.localStorage).length > 0 ? state.localStorage : 'None');
    console.log('Open dialogs:', state.dialogs.length > 0 ? state.dialogs : 'None');
  }

  await browser.disconnect();
}

check().catch(console.error);
