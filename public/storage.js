// Dati salvati solo su questo dispositivo (localStorage). Mai un errore: in
// navigazione privata o con la memoria piena l'app funziona comunque.

/** The stored value, or `fallback` if missing or unreadable. */
export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Store a value (null removes it). False if the browser refused (e.g. storage full). */
export function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
