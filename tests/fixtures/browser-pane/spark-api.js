const params = new URLSearchParams(location.search);
const target = params.get('api') ?? 'http://127.0.0.1:1';
const token = params.get('token');
const attempts = [
  ['plain', {}],
  ['with-token', token ? { headers: { 'X-Spark-Token': token } } : {}],
  ['no-cors', { mode: 'no-cors' }],
];
const lines = [];
const finish = () => {
  document.getElementById('result').textContent = lines.join('\n');
  document.title = `probe done ${lines.length}`;
};
Promise.all(
  attempts.map(([name, init]) =>
    fetch(`${target}/api/health`, init)
      .then((response) => lines.push(`${name}: answered ${response.type} ${response.status}`))
      .catch((error) => lines.push(`${name}: blocked ${error.message}`)),
  ),
).then(finish);
