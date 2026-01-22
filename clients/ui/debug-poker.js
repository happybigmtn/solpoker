const puppeteer = require('puppeteer-core');

async function debug() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222'
  });

  const pages = await browser.pages();
  const pokerPage = pages.find(p => p.url().includes('poker.regenesis.dev'));

  if (!pokerPage) {
    console.log('No poker page found. Pages:', pages.map(p => p.url()));
    await browser.disconnect();
    return;
  }

  console.log('Connected to:', pokerPage.url());

  // Listen for console messages
  pokerPage.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`CONSOLE [${type}]:`, msg.text().substring(0, 300));
    }
  });

  // Listen for page errors
  pokerPage.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message.substring(0, 300));
  });

  // Get page content
  const content = await pokerPage.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 1500),
      url: window.location.href,
      errors: window.__NEXT_DATA__ ? 'Next.js loaded' : 'No Next.js data'
    };
  });

  console.log('\n=== PAGE INFO ===');
  console.log('URL:', content.url);
  console.log('Next.js:', content.errors);
  console.log('\n=== PAGE TEXT ===');
  console.log(content.text);
  console.log('=================\n');

  // Check for any React error boundaries
  const hasErrors = await pokerPage.evaluate(() => {
    const errorBoundary = document.querySelector('[data-nextjs-error-code]');
    const errorText = document.body.innerText.match(/error|failed|cannot/gi);
    return {
      hasErrorBoundary: !!errorBoundary,
      errorMatches: errorText ? errorText.slice(0, 5) : []
    };
  });

  console.log('Error boundary:', hasErrors.hasErrorBoundary);
  console.log('Error text matches:', hasErrors.errorMatches);

  // Try to find join button
  const buttons = await pokerPage.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map(b => ({
      text: b.innerText.substring(0, 50),
      disabled: b.disabled,
      className: b.className.substring(0, 50)
    }));
  });

  console.log('\n=== BUTTONS ===');
  buttons.forEach(b => console.log(`- "${b.text}" disabled:${b.disabled}`));

  // Check console errors collected during page load
  const consoleErrors = await pokerPage.evaluate(() => {
    // Check if there were any unhandled promise rejections
    return window.__CONSOLE_ERRORS || [];
  });

  if (consoleErrors.length > 0) {
    console.log('\n=== STORED ERRORS ===');
    consoleErrors.forEach(e => console.log(e));
  }

  await browser.disconnect();
}

debug().catch(err => {
  console.error('Script error:', err.message);
  process.exit(1);
});
