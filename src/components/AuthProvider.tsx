'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  plan: string;
  planExpiresAt: Date | null;
  role: string;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, plan: 'free', planExpiresAt: null, role: 'USER' });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('free');
  const [planExpiresAt, setPlanExpiresAt] = useState<Date | null>(null);
  const [role, setRole] = useState('USER');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let unsubscribeDoc: any = null;
    
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser: User | null) => {
      setUser(currentUser);
      
      if (currentUser) {
        const userEmail = (currentUser.email || '').toLowerCase().trim();
        const isSuperAdmin = userEmail === 'mahesh.gupta8952@gmail.com' || userEmail === 'dixitshubham68359@gmail.com';
        let resolvedRole = isSuperAdmin ? 'SUPER_ADMIN' : 'USER';
        setRole(resolvedRole);

        currentUser.getIdTokenResult(true).then(tokenResult => {
          if (tokenResult.claims?.role) {
            setRole(tokenResult.claims.role as string);
          } else if (isSuperAdmin) {
            setRole('SUPER_ADMIN');
          }
        }).catch(err => {
          console.error("Token role fetch error", err);
        });

        import('firebase/firestore').then(({ doc, onSnapshot }) => {
          unsubscribeDoc = onSnapshot(doc(db, 'users', currentUser.uid), (docSnap) => {
            const docData = docSnap.exists() ? docSnap.data() : null;
            let p = docData?.plan || 'free';
            let expires: Date | null = null;
            
            if (docData?.planExpiresAt) {
              const expiresAt = docData.planExpiresAt.toDate ? docData.planExpiresAt.toDate() : new Date(docData.planExpiresAt);
              if (new Date() > expiresAt) {
                p = 'free';
                // Only update if it wasn't already free to prevent infinite loops
                if (docData.plan !== 'free') {
                   import('firebase/firestore').then(({ updateDoc }) => {
                     updateDoc(doc(db, 'users', currentUser.uid), { plan: 'free' }).catch(console.error);
                   });
                }
              } else {
                expires = expiresAt;
              }
            }
            
            setPlan(p);
            setPlanExpiresAt(expires);
            localStorage.setItem('kaktus_user_plan', p);
            localStorage.setItem('kaktus_user_uid', currentUser.uid);
            localStorage.setItem('kaktus_user_email', (currentUser.email || '').toLowerCase().trim());
            setLoading(false);
          });
        });
      } else {
        setRole('USER');
        setPlan('free');
        setPlanExpiresAt(null);
        localStorage.removeItem('kaktus_user_plan');
        localStorage.removeItem('kaktus_user_uid');
        localStorage.removeItem('kaktus_user_email');
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('hardware-studio-') || key.startsWith('gemini_key_usage_stats_') || key.startsWith('lastTokenReset_'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        setLoading(false);
        if (unsubscribeDoc) unsubscribeDoc();
      }
      
      // Route guarding logic
      if (!currentUser && (pathname === '/ide' || pathname === '/pcb-designer' || pathname === '/admin' || pathname === '/profile')) {
        router.push('/login?redirect=' + pathname);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, [pathname, router]);

  // Active check for plan expiration (e.g. 10-minute expiry)
  useEffect(() => {
    if (!user || plan === 'free' || !planExpiresAt) return;
    const interval = setInterval(() => {
      if (new Date() > planExpiresAt) {
        setPlan('free');
        setPlanExpiresAt(null);
        localStorage.setItem('kaktus_user_plan', 'free');
        toast.info('Your plan validity has ended (10-minute expiry). Reverted to Free tier.');
        import('firebase/firestore').then(({ doc, updateDoc }) => {
          updateDoc(doc(db, 'users', user.uid), { plan: 'free', planExpiresAt: null }).catch(console.error);
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [user, plan, planExpiresAt]);

  // Separate effect for intervals
  useEffect(() => {
    if (!user) return;
    
    let lastRestored = parseInt(localStorage.getItem(`lastTokenReset_${user.uid}`) || '0');
    if (lastRestored === 0) {
      lastRestored = Date.now();
      localStorage.setItem(`lastTokenReset_${user.uid}`, lastRestored.toString());
    }
    
    let warningGiven = false;

    const interval = setInterval(() => {
      const now = Date.now();
      
      // 1. Expiry & 45s Warning Logic
      if (planExpiresAt) {
        const expires = planExpiresAt.getTime();
        const diffSeconds = Math.floor((expires - now) / 1000);

        // Auto-downgrade
        if (diffSeconds <= 0) {
          clearInterval(interval);
          import('firebase/firestore').then(async ({ updateDoc, doc }) => {
            await updateDoc(doc(db, 'users', user.uid), { plan: 'free' });
            setPlan('free');
            toast.error('Your subscription has expired!', { duration: Infinity });
          });
          return;
        }

        // 45 sec warning
        if (diffSeconds <= 45 && !warningGiven) {
          warningGiven = true;
          toast.error('Attention: Your subscription is expiring in 45 seconds!', {
            duration: 10000,
            position: 'top-center',
          });
        }
      }

      // 2. 24-Hour Daily Quota (Tokens) Restore Logic
      if (now - lastRestored >= 24 * 60 * 60 * 1000) {
        lastRestored = now;
        localStorage.setItem(`lastTokenReset_${user.uid}`, now.toString());
        
        let maxRuns = 0;
        if (plan === 'free') maxRuns = 5;
        if (plan === 'starter') maxRuns = 10;
        if (plan === 'booster') maxRuns = 20;
        if (plan === 'pro') maxRuns = 50;

        if (maxRuns > 0) {
          import('firebase/firestore').then(async ({ updateDoc, doc }) => {
            await updateDoc(doc(db, 'users', user.uid), { proRuns: maxRuns });
            
            // Clear local storage token usage to reset the UI token bar
            localStorage.removeItem(`gemini_key_usage_stats_${user.uid}`);
            window.dispatchEvent(new Event('geminiUsageUpdated'));
            
            toast.success(`Daily Quota Renewed: Your tokens and runs have been refreshed.`, {
              duration: 10000,
              position: 'bottom-right'
            });
          });
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [plan, planExpiresAt?.getTime(), user?.uid]);

  return (
    <AuthContext.Provider value={{ user, loading, plan, planExpiresAt, role }}>
      {children}
    </AuthContext.Provider>
  );
}
