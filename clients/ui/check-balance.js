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

  // Get wallet address from the page by executing in browser context
  const walletInfo = await pokerPage.evaluate(() => {
    // Try to find the wallet address from window or the Solana wallet adapter
    if (window.solana && window.solana.publicKey) {
      return window.solana.publicKey.toString();
    }
    // Try phantom
    if (window.phantom && window.phantom.solana && window.phantom.solana.publicKey) {
      return window.phantom.solana.publicKey.toString();
    }
    return null;
  });

  console.log('Wallet address from page:', walletInfo);

  // Also check the wallet popup for more info
  const walletPage = pages.find(p => p.url().includes('chrome-extension'));
  if (walletPage) {
    const content = await walletPage.evaluate(() => document.body.innerText);
    console.log('\nWallet popup content:\n', content);
  }

  await browser.disconnect();
}

check().catch(console.error);
