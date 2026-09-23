// Chiamate al server. Se l'API è protetta da password (401 "locked"), avvisa
// l'app, che mostra la schermata di accesso.

let onLocked = () => {};

/** Called whenever the server says a password is needed. */
export function setLockedHandler(fn) {
  onLocked = fn;
}

export class LockedError extends Error {}

export async function request(path, init) {
  const res = await fetch(path, init);
  if (res.status === 401) {
    onLocked();
    throw new LockedError("Accesso protetto");
  }
  return res;
}

export const getJSON = async (path) => (await request(path)).json();

export const postJSON = (path, body, init = {}) =>
  request(path, { ...init, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
