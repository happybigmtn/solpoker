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

  // Navigate fresh
  console.log('Navigating to /table/1768850505602...');
  await pokerPage.goto('https://poker.regenesis.dev/table/1768850505602', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // Check what React state sees
  const info = await pokerPage.evaluate(() => {
    // Try to find React fiber info
    const root = document.getElementById('__next') || document.body.firstElementChild;

    // Get current URL info that JS can see
    return {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      // Parse ID from pathname manually
      pathSegments: window.location.pathname.split('/').filter(Boolean),
      manualTableId: window.location.pathname.split('/').filter(Boolean)[1], // ['table', '123'] -> '123'
      bodyText: document.body.innerText.substring(0, 300)
    };
  });

  console.log('\n=== URL PARSING ===');
  console.log('Pathname:', info.pathname);
  console.log('Path segments:', info.pathSegments);
  console.log('Manual table ID:', info.manualTableId);
  console.log('\nBody:', info.bodyText);

  await browser.disconnect();
}

debug().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
