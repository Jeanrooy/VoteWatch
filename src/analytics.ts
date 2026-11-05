const containerId = import.meta.env.VITE_GTM_ID?.trim();

if (containerId && /^GTM-[A-Z0-9]+$/.test(containerId)) {
  const analyticsWindow = window as typeof window & { dataLayer?: unknown[] };
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
  document.head.appendChild(script);
}
