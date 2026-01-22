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

  console.log('URL:', pokerPage.url());

  const state = await pokerPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
    const bodyText = document.body.innerText;
    const hasError = bodyText.includes('Error') || bodyText.includes('error') || bodyText.includes('failed');
    const hasSuccess = bodyText.includes('Joined') || bodyText.includes('success');

    return {
      buttons,
      hasError,
      hasSuccess,
      excerpt: bodyText.substring(0, 1500)
    };
  });

  console.log('Buttons:', state.buttons);
  console.log('Has Error:', state.hasError);
  console.log('Has Success:', state.hasSuccess);
  console.log('\nPage excerpt:\n', state.excerpt);

  await browser.disconnect();
}

check().catch(console.error);
