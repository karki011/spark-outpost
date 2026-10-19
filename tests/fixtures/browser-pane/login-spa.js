const form = document.querySelector('form');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  console.log('signing in', data.get('email'), data.get('password'));
  const query = new URLSearchParams({ email: data.get('email'), password: data.get('password') });
  void fetch(`welcome.html?${query}`);
  document.querySelector('#status').textContent = `Signed in as ${data.get('email')}`;
  document.title = `Welcome ${data.get('email')}`;
});
