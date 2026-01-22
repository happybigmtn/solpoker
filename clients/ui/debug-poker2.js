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

  console.log('Current URL:', pokerPage.url());

  // Navigate to a specific table
  console.log('\nNavigating to /table/1768850505602...');
  await pokerPage.goto('https://poker.regenesis.dev/table/1768850505602', { waitUntil: 'networkidle0' });

  // Wait a bit for React to hydrate
  await new Promise(r => setTimeout(r, 2000));

  const info = await pokerPage.evaluate(() => {
    return {
      url: window.location.href,
      pathname: window.location.pathname,
      bodyText: document.body.innerText.substring(0, 800),
      // Check for table-specific elements
      hasTableViz: !!document.querySelector('[class*="poker-table"]') || document.body.innerText.includes('Table '),
      hasPokerActions: !!document.querySelector('[class*="poker-action"]') || document.body.innerText.includes('Waiting for your turn'),
      // Check for errors
      errorText: document.body.innerText.match(/error|fail|cannot|invalid/gi)
    };
  });

  console.log('\n=== AFTER NAVIGATION ===');
  console.log('URL:', info.url);
  console.log('Pathname:', info.pathname);
  console.log('Has table viz:', info.hasTableViz);
  console.log('Has poker actions:', info.hasPokerActions);
  console.log('Error matches:', info.errorText);
  console.log('\nPage text:');
  console.log(info.bodyText);

  await browser.disconnect();
}

debug().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
