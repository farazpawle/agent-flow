let dict = {};
let loaded = false;

export async function loadLocale(lang = "en") {
  try {
    const res = await fetch(`/locales/${lang}.json`, { cache: "no-cache" });
    if (res.ok) dict = await res.json();
  } catch (err) {
    console.warn("Failed to load locale", lang, err);
  }
  loaded = true;
}

export function t(key, vars = {}) {
  let s = dict[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n-key]").forEach((node) => {
    const key = node.getAttribute("data-i18n-key");
    if (!key) return;
    const val = dict[key];
    if (typeof val === "string") node.textContent = val;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    const key = node.getAttribute("data-i18n-placeholder");
    if (!key) return;
    const val = dict[key];
    if (typeof val === "string") node.setAttribute("placeholder", val);
  });
}

export function isLoaded() {
  return loaded;
}
