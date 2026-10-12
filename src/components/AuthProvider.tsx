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
  testQuotaMode: string | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, plan: 'free', planExpiresAt: null, role: 'USER', testQuotaMode: null });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('free');
  const [planExpiresAt, setPlanExpiresAt] = useState<Date | null>(null);
  const [role, setRole] = useState('USER');
  const [testQuotaMode, setTestQuotaMode] = useState<string | null>(null);
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
        localStorage.setItem('kaktus_user_role', resolvedRole);

        currentUser.getIdTokenResult(true).then(tokenResult => {
          let claimsRole = tokenResult.claims?.role as string | undefined;
          let claimsMode = tokenResult.claims?.testQuotaMode as string | undefined;
          
          if (claimsRole) {
            setRole(claimsRole);
            localStorage.setItem('kaktus_user_role', claimsRole);
          } else if (isSuperAdmin) {
            setRole('SUPER_ADMIN');
            localStorage.setItem('kaktus_user_role', 'SUPER_ADMIN');
          }
          if (claimsMode) {
            setTestQuotaMode(claimsMode);
            localStorage.setItem('kaktus_user_test_quota_mode', claimsMode);
          }
        }).catch(err => {
          console.error("Token role fetch error", err);
        });

        import('firebase/firestore').then(({ doc, onSnapshot }) => {
          unsubscribeDoc = onSnapshot(doc(db, 'users', currentUser.uid), (docSnap) => {
            const docData = docSnap.exists() ? docSnap.data() : null;
            let p = docData?.plan || 'free';
            let expires: Date | null = null;

            if (docData?.role) {
              setRole(docData.role);
              localStorage.setItem('kaktus_user_role', docData.role);
            }
            if (docData?.testQuotaMode) {
              setTestQuotaMode(docData.testQuotaMode);
              localStorage.setItem('kaktus_user_test_quota_mode', docData.testQuotaMode);
            }
            
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
            if (expires) {
              localStorage.setItem('kaktus_user_plan_expires_at', expires.toISOString());
            } else {
              localStorage.removeItem('kaktus_user_plan_expires_at');
            }
            localStorage.setItem('kaktus_user_uid', currentUser.uid);
            localStorage.setItem('kaktus_user_email', (currentUser.email || '').toLowerCase().trim());
            setLoading(false);
          });
        });
      } else {
        setRole('USER');
        setTestQuotaMode(null);
        setPlan('free');
        setPlanExpiresAt(null);
        localStorage.removeItem('kaktus_user_role');
        localStorage.removeItem('kaktus_user_test_quota_mode');
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

  // Active check for plan expiration
  useEffect(() => {
    if (!user || plan === 'free' || !planExpiresAt) return;
    const interval = setInterval(() => {
      if (new Date() >= planExpiresAt) {
        setPlan('free');
        setPlanExpiresAt(null);
        localStorage.setItem('kaktus_user_plan', 'free');
        localStorage.removeItem('kaktus_user_plan_expires_at');
        toast.info('Your plan validity period has ended. Reverted to Free tier.');
        import('firebase/firestore').then(({ doc, updateDoc }) => {
          updateDoc(doc(db, 'users', user.uid), { plan: 'free', planExpiresAt: null }).catch(console.error);
        });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [user, plan, planExpiresAt]);

  // Separate effect for intervals: Expiry warning & 12:00 AM Midnight Token Reset
  useEffect(() => {
    if (!user) return;

    let warningGiven = false;

    const interval = setInterval(() => {
      const now = Date.now();
      
      // 1. Expiry Check
      if (planExpiresAt) {
        const expires = planExpiresAt.getTime();
        const diffSeconds = Math.floor((expires - now) / 1000);

        // Auto-downgrade when period ends
        if (diffSeconds <= 0) {
          clearInterval(interval);
          import('firebase/firestore').then(async ({ updateDoc, doc }) => {
            await updateDoc(doc(db, 'users', user.uid), { plan: 'free', planExpiresAt: null }).catch(console.error);
            setPlan('free');
            setPlanExpiresAt(null);
            localStorage.setItem('kaktus_user_plan', 'free');
            localStorage.removeItem('kaktus_user_plan_expires_at');
            toast.error('Your subscription period has ended. Returned to Free plan.', { duration: 8000 });
          });
          return;
        }

        // 1-minute warning before final expiry
        if (diffSeconds <= 60 && !warningGiven) {
          warningGiven = true;
          toast.warning('Attention: Your subscription validity is ending in 1 minute!', {
            duration: 8000,
            position: 'top-center',
          });
        }
      }

      // 2. Midnight (12:00 AM) Token & Quota Reset for ALL plans
      const nowObj = new Date();
      const todayKey = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, '0')}-${String(nowObj.getDate()).padStart(2, '0')}`;
      const lastResetKey = localStorage.getItem(`lastTokenMidnightReset_${user.uid}`);
      
      if (lastResetKey !== todayKey) {
        localStorage.setItem(`lastTokenMidnightReset_${user.uid}`, todayKey);
        
        let maxRuns = 5;
        if (plan === 'starter') maxRuns = 10;
        if (plan === 'booster') maxRuns = 20;
        if (plan === 'pro') maxRuns = 50;

        import('firebase/firestore').then(async ({ updateDoc, doc }) => {
          await updateDoc(doc(db, 'users', user.uid), { proRuns: maxRuns }).catch(() => {});
          
          window.dispatchEvent(new CustomEvent('geminiUsageUpdated', { detail: { resetDate: todayKey } }));
          
          toast.success(`Daily Quota Renewed (12:00 AM Reset): Your tokens and runs have been refreshed.`, {
            duration: 6000,
            position: 'bottom-right'
          });
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [plan, planExpiresAt?.getTime(), user?.uid]);

  return (
    <AuthContext.Provider value={{ user, loading, plan, planExpiresAt, role, testQuotaMode }}>
      {children}
    </AuthContext.Provider>
  );
}
