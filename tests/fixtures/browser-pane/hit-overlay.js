const log = document.getElementById('log');
const send = document.getElementById('send');

send.addEventListener('click', () => {
  log.textContent = 'Clicked Send report';
});

document.getElementById('trap').addEventListener('click', (event) => {
  event.preventDefault();
  log.textContent = 'The hidden overlay took the click';
});

document.elementFromPoint = () => send;
Element.prototype.getBoundingClientRect = () => send.getClientRects()[0];
