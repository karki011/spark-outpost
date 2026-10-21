const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FALLBACK = { title: 'Spark Outpost', body: 'A chat needs you', chatId: null, tag: 'spark' };

function messageOf(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') return FALLBACK;
    const chatId =
      typeof data.chatId === 'string' && CHAT_ID.test(data.chatId) ? data.chatId : null;
    const tag = typeof data.tag === 'string' ? data.tag : FALLBACK.tag;
    return { title: data.title, body: data.body, chatId, tag };
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

async function closeShown(tag) {
  const shown = await self.registration.getNotifications({ tag });
  for (const notification of shown) notification.close();
}

self.addEventListener('push', (event) => {
  const closing = closeTagOf(event);
  if (closing) {
    event.waitUntil(closeShown(closing));
    return;
  }
  const message = messageOf(event);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { chatId: message.chatId },
    }),
  );
});

async function openChat(chatId) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (open) {
    await open.focus();
    if (chatId) open.postMessage({ type: 'spark-open-chat', chatId });
    return;
  }
  await self.clients.openWindow(chatId ? `/?chat=${chatId}` : '/');
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  event.waitUntil(openChat(typeof chatId === 'string' && CHAT_ID.test(chatId) ? chatId : null));
});
