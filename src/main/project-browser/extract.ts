// Runs in an isolated world with no app preload or Node access.
export const PAGE_TEXT_SCRIPT = `(() => {
  const visibleText = el => el && typeof el.innerText === 'string' ? el.innerText : '';
  const roots = [...document.querySelectorAll('main, article, [role="main"]')]
    .filter(el => el.getClientRects().length && !el.closest('[hidden], [aria-hidden="true"]'));
  const candidates = roots.map(visibleText).filter(text => text.trim().length > 100);
  const source = candidates.sort((a, b) => b.length - a.length)[0] || visibleText(document.body);
  const text = source.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { text: text.slice(0, 60000), truncated: text.length > 60000 };
})()`
