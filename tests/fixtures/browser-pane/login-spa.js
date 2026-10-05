const form = document.querySelector('form');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  console.log('signing in', data.get('email'), data.get('password'));
  document.querySelector('#status').textContent = `Signed in as ${data.get('email')}`;
  document.title = `Welcome ${data.get('email')}`;
});
