const log = document.getElementById('log');

function clicked(name) {
  return () => {
    log.textContent = `Clicked ${name}`;
  };
}

document.getElementById('buy').addEventListener('click', clicked('Buy now'));
document.getElementById('partial').addEventListener('click', clicked('Half hidden'));
document.getElementById('banner').addEventListener('click', clicked('the cookie banner'));
document.getElementById('accept').addEventListener('click', (event) => {
  event.stopPropagation();
  document.getElementById('banner').remove();
  log.textContent = 'Cookies accepted';
});

for (const mode of ['open', 'closed']) {
  const root = document.getElementById(`${mode}-host`).attachShadow({ mode });
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Shadow ${mode}`;
  button.style.width = '160px';
  button.style.height = '40px';
  button.addEventListener('click', clicked(`Shadow ${mode}`));
  root.append(button);
}
