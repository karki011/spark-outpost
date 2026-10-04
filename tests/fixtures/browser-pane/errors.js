console.warn('fixture warning: slow render');
console.error('fixture error: widget failed', { code: 42 });
fetch('/missing.json?token=sk-fixture-not-a-real-key-000000000000', {
  headers: { Authorization: 'Bearer fixture-header-secret' },
})
  .then((response) => {
    document.getElementById('result').textContent = `missing.json answered ${response.status}`;
  })
  .then(() => {
    throw new Error('fixture uncaught failure');
  });
