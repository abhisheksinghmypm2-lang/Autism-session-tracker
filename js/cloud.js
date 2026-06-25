// ============================================================
//  Firebase cloud adapter (loaded lazily, only when sync is enabled)
// ============================================================
// Exposes the SAME shape as js/db.js (getAll/get/put/delete/clear/byIndex)
// so the rest of the app doesn't care whether it's talking to local
// IndexedDB or the cloud. Plus auth + document (file) storage helpers.
//
// Data model in Firestore:  users/{uid}/{store}/{docId}
//   programs & sessions  -> docId = value.id
//   checks & kv          -> docId = value.key
// Uploaded documents go to Cloud Storage at users/{uid}/docs/{id}.

const V = '10.12.5';
const CDN = (m) => `https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`;

export async function createCloud(config) {
  const { initializeApp } = await import(CDN('app'));
  const auth = await import(CDN('auth'));
  const fs = await import(CDN('firestore'));
  const st = await import(CDN('storage'));

  const app = initializeApp(config);

  // Firestore with on-device cache => offline support + fast reads.
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app); // fallback if persistence can't initialize
  }

  const authI = auth.getAuth(app);
  try { await auth.setPersistence(authI, auth.browserLocalPersistence); } catch {}
  const storage = st.getStorage(app);

  let uid = null;
  const col = (store) => fs.collection(db, 'users', uid, store);
  const ref = (store, id) => fs.doc(db, 'users', uid, store, id);
  const docId = (v) => String(v.id ?? v.key);

  // Never let a cloud call hang the UI forever (e.g. missing DB / no network).
  const TIMEOUT = 10000;
  const guard = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('cloud-timeout')), TIMEOUT)),
  ]);

  const dbApi = {
    async getAll(store) {
      const snap = await guard(fs.getDocs(col(store)));
      return snap.docs.map((d) => d.data());
    },
    async get(store, key) {
      const s = await guard(fs.getDoc(ref(store, String(key))));
      return s.exists() ? s.data() : undefined;
    },
    async put(store, value) {
      await guard(fs.setDoc(ref(store, docId(value)), value));
      return value;
    },
    async delete(store, key) {
      await guard(fs.deleteDoc(ref(store, String(key))));
    },
    async clear(store) {
      const snap = await guard(fs.getDocs(col(store)));
      const batch = fs.writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await guard(batch.commit());
    },
    async byIndex(store, field, value) {
      const snap = await guard(fs.getDocs(fs.query(col(store), fs.where(field, '==', value))));
      return snap.docs.map((d) => d.data());
    },
  };

  return {
    db: dbApi,
    currentUser: () => authI.currentUser,
    onUser(cb) {
      return auth.onAuthStateChanged(authI, (user) => { uid = user?.uid ?? null; cb(user); });
    },
    async signIn(email, password) {
      const cred = await auth.signInWithEmailAndPassword(authI, email, password);
      return cred.user;
    },
    async signUp(email, password) {
      const cred = await auth.createUserWithEmailAndPassword(authI, email, password);
      return cred.user;
    },
    signOutUser() { return auth.signOut(authI); },

    // ---- document (file) storage ----
    async uploadDocument(file, name) {
      const id = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
      const path = `users/${uid}/docs/${id}`;
      const r = st.ref(storage, path);
      await st.uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
      const url = await st.getDownloadURL(r);
      return { id, name: name || file.name || 'document', type: file.type || '', size: file.size || 0, url, path };
    },
    async deleteDocument(path) {
      try { await st.deleteObject(st.ref(storage, path)); } catch {}
    },
  };
}
