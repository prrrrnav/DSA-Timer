import { useState, useEffect } from "react";
import { User, LogOut, Mail, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../lib/supabase";
export default function UserProfile() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubConnecting, setGithubConnecting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      // 1. Check Supabase First
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        if (!isMounted) return;
        if (session.provider_token) saveGitHubToken(session);
        setUser({
          name: session.user.user_metadata?.full_name || session.user.email,
          email: session.user.email,
          picture: session.user.user_metadata?.avatar_url || ''
        });
        setLoading(false);
        return; // Stop checking Google! 
      }

      // 2. If no Supabase session, silently check Google Auth fallback
      if (typeof chrome !== "undefined" && chrome.identity) {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (!isMounted) return;
          if (chrome.runtime.lastError || !token) {
            setLoading(false);
            return;
          }
          fetchUserProfile(token);
        });
      } else {
        if (isMounted) setLoading(false);
      }
    };

    initAuth();

    // 3. Listen to Supabase Auth Changes dynamically
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        if (event === 'SIGNED_IN' && session) {
          if (session.provider_token) saveGitHubToken(session);
          setUser({
            name: session.user.user_metadata?.full_name || session.user.email,
            email: session.user.email,
            picture: session.user.user_metadata?.avatar_url || ''
          });
          setLoading(false);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setGithubConnected(false);
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const checkGitHubStatus = async () => {
      if (user && user.email) {
        const { data } = await supabase
          .from('users')
          .select('github_token')
          .eq('email', user.email)
          .single();
        
        if (data && data.github_token) {
          setGithubConnected(true);
        }
      }
    };
    checkGitHubStatus();
  }, [user]);

  const saveGitHubToken = async (session) => {
    try {
      await supabase.from('users').upsert({
        id: session.user.id,
        email: session.user.email,
        github_token: session.provider_token
      });
      setGithubConnected(true);
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.set({ ghToken: session.provider_token });
      }
    } catch (err) {
      console.error("Error saving GitHub token:", err);
    }
  };

  const connectGitHub = async () => {
    setGithubConnecting(true);
    setError("");

    if (typeof chrome === "undefined" || !chrome.identity) {
      setError("Please run this inside the Chrome Extension");
      setGithubConnecting(false);
      return;
    }

    try {
      const redirectUri = chrome.identity.getRedirectURL();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          scopes: 'repo',
          redirectTo: redirectUri,
          skipBrowserRedirect: true
        }
      });

      if (error) throw error;
      if (!data?.url) throw new Error("Could not construct auth URL");

      chrome.identity.launchWebAuthFlow({
        url: data.url,
        interactive: true
      }, async (callbackUrl) => {
        if (chrome.runtime.lastError || !callbackUrl) {
          let msg = chrome.runtime.lastError?.message || "Auth flow canceled or failed.";
          if (msg.toLowerCase().includes("authorization page could not be loaded")) {
            msg = `ACTION REQUIRED: Go to Supabase Dashboard -> Authentication -> URL Configuration -> Redirect URLs. You MUST add this exact URL: ${redirectUri}`;
          }
          setError(msg);
          setGithubConnecting(false);
          return;
        }

        try {
          const urlObj = new URL(callbackUrl);
          const hashParams = new URLSearchParams(urlObj.hash.substring(1));
          const queryParams = new URLSearchParams(urlObj.search);

          if (hashParams.has('access_token')) {
            const { error: sessionErr } = await supabase.auth.setSession({
              access_token: hashParams.get('access_token'),
              refresh_token: hashParams.get('refresh_token')
            });
            if (sessionErr) throw sessionErr;
          } else if (queryParams.has('code')) {
            const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(queryParams.get('code'));
            if (exchangeErr) throw exchangeErr;
          } else if (queryParams.has('error_description')) {
            throw new Error(queryParams.get('error_description'));
          } else {
            throw new Error(`Callback unparseable. URL: ${callbackUrl}`);
          }
        } catch (err) {
          setError(`Supabase Auth Error: ${err.message}`);
        } finally {
          setGithubConnecting(false);
        }
      });
    } catch (err) {
      setError(err.message);
      setGithubConnecting(false);
    }
  };

  const performWebAuthFlow = (interactive) => {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest?.oauth2?.client_id;
    if (!clientId) {
      if (interactive) setError("OAuth2 Client ID is missing in manifest.json");
      setLoading(false);
      return;
    }

    const scopes = encodeURIComponent((manifest.oauth2.scopes || []).join(" "));
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        let msg = chrome.runtime.lastError?.message || "Web Auth Flow failed.";
        if (msg.includes("authorization page could not be loaded")) {
           msg = `Redirect URI mismatch. Please add this exact URL to your Google Cloud Authorized redirect URIs: ${redirectUri}`;
        }
        if (interactive) {
          setError(msg);
        }
        setLoading(false);
        return;
      }
      const match = redirectUrl.match(/[#|?|&]access_token=([^&]+)/);
      if (match && match[1]) {
        fetchUserProfile(match[1]);
      } else {
        if (interactive) setError("Failed to extract access token.");
        setLoading(false);
      }
    });
  };

  const fetchUserProfile = async (token) => {
    try {
      const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setUser(data);
        setError("");
      }
    } catch (err) {
      setError("Failed to fetch user profile.");
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = () => {
    setLoading(true);
    setError("");
    if (typeof chrome !== "undefined" && chrome.identity) {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          let errMsg = chrome.runtime.lastError.message;
          if (errMsg.includes("Function unsupported")) {
             // Fallback for Edge/Brave which do not support getAuthToken
             performWebAuthFlow(true);
             return;
          }
          if (errMsg.includes("OAuth2 not granted or revoked")) {
             errMsg = "To use Google Sign-In, please configure the OAuth2 Client ID in manifest.json and load the extension with the matching ID.";
          }
          setError(errMsg);
          setLoading(false);
          return;
        }
        fetchUserProfile(token);
      });
    } else {
      setTimeout(() => {
        setError("Chrome Identity API not available (must run as extension).");
        setLoading(false);
      }, 500);
    }
  };

  const logout = async () => {
    setLoading(true);
    setUser(null);
    setGithubConnected(false);
    setError("");
    
    try {
      // Sign out from Supabase
      await supabase.auth.signOut();

      // Clear Chrome Identity cached token
      if (typeof chrome !== "undefined" && chrome.identity && chrome.identity.removeCachedAuthToken) {
         chrome.identity.getAuthToken({ interactive: false }, (token) => {
           if (token) {
             chrome.identity.removeCachedAuthToken({ token }, () => {
               fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
               setLoading(false);
             });
           } else {
             setLoading(false);
           }
         });
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error("Sign out error:", err);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <User className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-semibold text-gray-100 tracking-tight">Account</h2>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center p-8 border border-white/5 bg-white/[0.02] rounded-[18px] min-h-[220px]"
          >
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
            <p className="text-sm text-gray-400">Authenticating...</p>
          </motion.div>
        ) : user ? (
          <motion.div
            key="profile"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col gap-4"
          >
            {/* Profile Card */}
            <div className="relative overflow-hidden group border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent rounded-[20px] p-6 shadow-lg shadow-black/20">
              <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/5 to-transparent pointer-events-none" />
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="relative w-20 h-20 mb-4 rounded-full p-1 bg-gradient-to-tr from-purple-500 to-indigo-500">
                  <div className="w-full h-full rounded-full overflow-hidden bg-gray-900">
                    <img
                      src={user.picture}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                
                <h3 className="text-xl font-bold text-gray-100 mb-1 tracking-tight">{user.name}</h3>
                
                <div className="flex items-center gap-1.5 text-sm text-gray-400 bg-white/5 py-1 px-3 rounded-full">
                  <Mail className="w-3.5 h-3.5" />
                  <span>{user.email}</span>
                </div>
              </div>
            </div>

            <button
              onClick={logout}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-medium transition-all text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 active:scale-[0.98]"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="login"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center justify-center p-8 border border-white/5 bg-white/[0.02] rounded-[20px] min-h-[240px] relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.05)_0%,transparent_60%)] pointer-events-none" />
            
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-5 border border-white/10 shadow-inner">
              <svg className="w-8 h-8" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                <path fill="none" d="M1 1h22v22H1z" />
              </svg>
            </div>
            
            <h3 className="text-lg font-bold text-gray-100 mb-2">Welcome Back</h3>
            <p className="text-sm text-gray-400 text-center mb-6">Sign in with Google to sync your settings.</p>

            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 py-3 px-4 rounded-xl font-semibold shadow-lg transition-all active:scale-[0.98]"
            >
              <svg className="w-5 h-5 bg-white rounded-full" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                <path fill="none" d="M1 1h22v22H1z" />
              </svg>
              Continue with Google
            </button>

            <button
              onClick={connectGitHub}
              disabled={githubConnecting}
              className="w-full mt-3 flex items-center justify-center gap-3 bg-[#24292f] hover:bg-[#2c3137] text-white py-3 px-4 rounded-xl font-semibold shadow-lg transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {githubConnecting ? (
                 <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              )}
              Continue with GitHub
            </button>

          </motion.div>
        )}
      </AnimatePresence>

      {/* GitHub Integration Section via Supabase */}
      {user && (
         <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           className="mt-4 border border-white/10 bg-white/[0.02] rounded-xl p-5"
         >
           <h3 className="text-sm font-semibold text-gray-100 mb-3 flex items-center gap-2">
             <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
               <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
             </svg>
             GitHub Connection
           </h3>
           
           <div className="flex items-center justify-between mb-4">
             <span className="text-sm text-gray-400">Status:</span>
             {githubConnected ? (
               <span className="text-sm font-medium text-green-400 flex items-center gap-1">
                 ✅ Connected
               </span>
             ) : (
               <span className="text-sm font-medium text-red-400 flex items-center gap-1">
                 ❌ Not connected
               </span>
             )}
           </div>

           {!githubConnected && (
             <button
               onClick={connectGitHub}
               disabled={githubConnecting}
               className="w-full flex items-center justify-center gap-2 bg-[#2ea043] hover:bg-[#2c974b] text-white py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
             >
               {githubConnecting ? (
                 <Loader2 className="w-4 h-4 animate-spin" />
               ) : (
                 <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                   <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                 </svg>
               )}
               {githubConnecting ? "Connecting..." : "Connect GitHub"}
             </button>
           )}
         </motion.div>
      )}

      {/* Global Error Display */}
      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-2 items-start text-left w-full"
        >
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed font-mono whitespace-pre-wrap break-all">{error}</p>
        </motion.div>
      )}

    </div>
  );
}
