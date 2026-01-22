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

  // Navigate fresh to a table URL
  console.log('Navigating to /table/1768850505602...');
  await pokerPage.goto('https://poker.regenesis.dev/table/1768850505602', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3000));

  const info = await pokerPage.evaluate(() => {
    // Check URL and pathname
    const url = window.location.href;
    const pathname = window.location.pathname;

    // Check Next.js router state
    const nextData = window.__NEXT_DATA__;
    const nextRouter = window.next?.router;

    return {
      url,
      pathname,
      nextData: nextData ? {
        page: nextData.page,
        query: nextData.query,
        buildId: nextData.buildId,
      } : 'No __NEXT_DATA__',
      routerQuery: nextRouter?.query,
      routerPathname: nextRouter?.pathname,
      routerAsPath: nextRouter?.asPath,
      bodyText: document.body.innerText.substring(0, 500)
    };
  });

  console.log('\n=== ROUTING DEBUG ===');
  console.log('Browser URL:', info.url);
  console.log('Browser pathname:', info.pathname);
  console.log('Next.js data:', JSON.stringify(info.nextData, null, 2));
  console.log('Router query:', info.routerQuery);
  console.log('Router pathname:', info.routerPathname);
  console.log('Router asPath:', info.routerAsPath);
  console.log('\nPage text:', info.bodyText);

  await browser.disconnect();
}

debug().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
