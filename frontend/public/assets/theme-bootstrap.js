// Paint the persisted theme before first paint. This file is deliberately a classic,
// parse-blocking script in <head>; keeping it self-hosted lets the site enforce a CSP without
// allowing arbitrary inline scripts.
try {
  var theme = localStorage.getItem("compcat.theme");
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
} catch (_error) {
  document.documentElement.setAttribute("data-theme", "dark");
}
