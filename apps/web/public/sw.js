const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARD_ID = CHAT_ID;
const FALLBACK = { title: 'Spark Outpost', body: 'A chat needs you', chatId: null, tag: 'spark' };

function messageOf(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') return FALLBACK;
    const chatId =
      typeof data.chatId === 'string' && CHAT_ID.test(data.chatId) ? data.chatId : null;
    const cardId =
      chatId && typeof data.cardId === 'string' && CARD_ID.test(data.cardId) ? data.cardId : null;
    const tag = typeof data.tag === 'string' ? data.tag : FALLBACK.tag;
    return { title: data.title, body: data.body, chatId, cardId, tag };
  } catch {
    return FALLBACK;
  }
}

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const CLOSE_TAG = /^spark-chat-[0-9a-f-]{36}$/;

function closeTagOf(event) {
  try {
    const data = event.data ? event.data.json() : null;
    return data && typeof data.close === 'string' && CLOSE_TAG.test(data.close) ? data.close : null;
  } catch {
    return null;
  }
}

async function replaceThenClose(tag) {
  await self.registration.showNotification('Spark Outpost', {
    body: 'Handled in Spark',
    tag,
    silent: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  });
  const shown = await self.registration.getNotifications({ tag });
  for (const notification of shown) notification.close();
}

self.addEventListener('push', (event) => {
  const closing = closeTagOf(event);
  if (closing) {
    event.waitUntil(replaceThenClose(closing));
    return;
  }
  const message = messageOf(event);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { chatId: message.chatId, cardId: message.cardId },
    }),
  );
});

async function openChat(chatId, cardId) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (open) {
    await open.focus();
    if (chatId)
      open.postMessage({ type: 'spark-open-chat', chatId, ...(cardId ? { cardId } : {}) });
    return;
  }
  const card = chatId && cardId ? `&card=${cardId}` : '';
  await self.clients.openWindow(chatId ? `/?chat=${chatId}${card}` : '/');
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { chatId, cardId } = event.notification.data ?? {};
  const chat = typeof chatId === 'string' && CHAT_ID.test(chatId) ? chatId : null;
  const card = chat && typeof cardId === 'string' && CARD_ID.test(cardId) ? cardId : null;
  event.waitUntil(openChat(chat, card));
});
