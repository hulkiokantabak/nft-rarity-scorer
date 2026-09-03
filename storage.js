const KEY = 'opensea_api_key';
const read = (store, key) => { try { return store?.getItem(key) || ''; } catch { return ''; } };
const remove = (store, key) => { try { store?.removeItem(key); } catch {} };
export function createKeyStore(session, persistent) {
  let memory = '';
  return {
    load() {
      // Migrate old automatic persistence to session-only. Remembering needs fresh consent.
      memory = read(session, KEY) || read(persistent, KEY);
      const remembered = read(persistent, 'nft_scorer_remember_key') === 'yes';
      if (!remembered) remove(persistent, KEY);
      if (memory && !remembered) { try { session?.setItem(KEY, memory); } catch {} }
      return { key: memory, remembered };
    },
    save(key, remember = false) {
      memory = key.trim();
      remove(session, KEY); remove(persistent, KEY); remove(persistent, 'nft_scorer_remember_key');
      try {
        if (memory) (remember ? persistent : session)?.setItem(KEY, memory);
        if (memory && remember) persistent?.setItem('nft_scorer_remember_key', 'yes');
      } catch { return 'memory'; }
      return remember ? 'remembered' : 'session';
    },
    clear() { memory = ''; remove(session, KEY); remove(persistent, KEY); remove(persistent, 'nft_scorer_remember_key'); },
    get() { return memory; }
  };
}
