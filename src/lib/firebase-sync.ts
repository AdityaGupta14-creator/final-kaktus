import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore'; 
import { db, auth } from './firebase'; 
import { CHAT_SESSION_REGISTRY_KEY, chatSessionKey, workspaceSessionKey } from './session-store'; 

export async function syncToSupabase(userOrUid: any, registry: any, workspaces: any, chats: any) {
  try {
    let token = null;
    if (userOrUid && typeof userOrUid.getIdToken === 'function') {
      token = await userOrUid.getIdToken();
    } else if (auth.currentUser) {
      token = await auth.currentUser.getIdToken();
    }
    if (!token) {
      return false;
    }

    const res = await fetch('/api/data/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ registry, workspaces, chats })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[Supabase Sync] Server responded with error:', res.status, errText);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Supabase Sync] Failed to sync to Supabase:', e);
    return false;
  }
}

export async function loadFromSupabase(userOrUid: any): Promise<boolean> {
  try {
    let token = null;
    let uid = typeof userOrUid === 'string' ? userOrUid : userOrUid?.uid;
    if (userOrUid && typeof userOrUid.getIdToken === 'function') {
      token = await userOrUid.getIdToken();
    } else if (auth.currentUser) {
      token = await auth.currentUser.getIdToken();
      uid = uid || auth.currentUser.uid;
    }
    if (!token || !uid) return false;

    const res = await fetch('/api/data/load', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) return false;
    const json = await res.json();
    if (json.success && json.data) {
      const { registry, workspaces, chats } = json.data;
      let hasData = false;

      if (registry) {
        localStorage.setItem(CHAT_SESSION_REGISTRY_KEY(uid), registry);
        hasData = true;
      }

      if (workspaces && typeof workspaces === 'object') {
        for (const [id, payload] of Object.entries(workspaces)) {
          if (payload) {
            localStorage.setItem(workspaceSessionKey(id, uid), typeof payload === 'string' ? payload : JSON.stringify(payload));
            hasData = true;
          }
        }
      }

      if (chats && typeof chats === 'object') {
        for (const [id, payload] of Object.entries(chats)) {
          if (payload) {
            localStorage.setItem(chatSessionKey(id, uid), typeof payload === 'string' ? payload : JSON.stringify(payload));
            hasData = true;
          }
        }
      }

      return hasData;
    }
    return false;
  } catch (e) {
    console.warn('[Supabase Load] Failed to load from Supabase:', e);
    return false;
  }
}

export async function syncToFirebase(userOrUid: any, registry: any, workspaces: any, chats: any) { 
  const uid = typeof userOrUid === 'string' ? userOrUid : userOrUid?.uid;
  if (!uid) return; 

  const syncPromises: Promise<any>[] = [];

  // 1. Supabase Sync (Authoritative relational storage)
  syncPromises.push(syncToSupabase(userOrUid, registry, workspaces, chats));

  // 2. Firebase Firestore Sync (Secondary backup)
  syncPromises.push((async () => {
    try { 
      await setDoc(doc(db, 'users', uid, 'data', 'registry'), { payload: JSON.stringify(registry) }); 
      
      const usageStr = localStorage.getItem(`gemini_key_usage_stats_${uid}`);
      if (usageStr) {
        await setDoc(doc(db, 'users', uid, 'data', 'usage'), { payload: usageStr });
      }

      for (let id in workspaces) { 
        await setDoc(doc(db, 'users', uid, 'workspaces', id), { payload: JSON.stringify(workspaces[id]) }); 
      } 
      for (let id in chats) { 
        await setDoc(doc(db, 'users', uid, 'chats', id), { payload: JSON.stringify(chats[id]) }); 
      } 
    } catch(e) { 
      console.warn('[Firebase Sync] Firestore sync error:', e); 
    } 
  })());

  await Promise.allSettled(syncPromises);
} 

export async function loadFromFirebase(userOrUid: any) { 
  const uid = typeof userOrUid === 'string' ? userOrUid : userOrUid?.uid;
  if (!uid) return false; 

  // Try loading from Supabase first
  const loadedFromSupabase = await loadFromSupabase(userOrUid);
  if (loadedFromSupabase) {
    return true;
  }

  // Fallback to Firebase
  try { 
    const regSnap = await getDoc(doc(db, 'users', uid, 'data', 'registry')); 
    if(!regSnap.exists()) return false; 
    
    const registryStr = regSnap.data().payload; 
    localStorage.setItem(CHAT_SESSION_REGISTRY_KEY(uid), registryStr); 
    
    const usageSnap = await getDoc(doc(db, 'users', uid, 'data', 'usage'));
    if (usageSnap.exists() && usageSnap.data().payload) {
      localStorage.setItem(`gemini_key_usage_stats_${uid}`, usageSnap.data().payload);
    }

    const wsSnap = await getDocs(collection(db, 'users', uid, 'workspaces')); 
    const wsMap: Record<string, any> = {};
    wsSnap.forEach((d: any) => {
      localStorage.setItem(workspaceSessionKey(d.id, uid), d.data().payload);
      try { wsMap[d.id] = JSON.parse(d.data().payload); } catch {}
    }); 
    
    const chatSnap = await getDocs(collection(db, 'users', uid, 'chats')); 
    const chatMap: Record<string, any> = {};
    chatSnap.forEach((d: any) => {
      localStorage.setItem(chatSessionKey(d.id, uid), d.data().payload);
      try { chatMap[d.id] = JSON.parse(d.data().payload); } catch {}
    }); 

    // Once loaded from Firebase, proactively seed into Supabase so Supabase is synced!
    try {
      const parsedRegistry = JSON.parse(registryStr);
      syncToSupabase(userOrUid, parsedRegistry, wsMap, chatMap).catch(console.warn);
    } catch {}
    
    return true; 
  } catch(e) { 
    console.error('Load failed', e); 
    return false; 
  } 
}

