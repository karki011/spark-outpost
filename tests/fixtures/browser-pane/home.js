const state = document.getElementById('cookie-state');
const show = () => {
  state.textContent = `cookie: ${document.cookie || 'none'}`;
};
document.getElementById('sign-in').addEventListener('click', () => {
  document.cookie = 'fixture_session=signed-in; max-age=86400; path=/';
  show();
});
show();
console.log('fixture home ready');
