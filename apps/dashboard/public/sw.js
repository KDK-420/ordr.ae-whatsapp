/* Service worker for the ordr.ae dashboard: shows "needs a person" pushes and opens the inbox on tap. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "ordr.ae", body: "A customer needs a person", url: "/inbox" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Not JSON: keep the defaults.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || "handoff",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url || "/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/inbox", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(self.location.origin));
      if (open) return open.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
