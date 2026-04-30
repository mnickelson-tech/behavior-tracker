// js/auth-ui.js
import { auth, provider, authFns } from "./firebase-init.js";

export function wireAuthUI({ onSignedIn, onSignedOut, isAdminEmail }) {␊
  const userLabel = document.getElementById("userLabel");
  const userRoleLabel = document.getElementById("userRoleLabel");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

    // Complete any redirect sign-in attempt (fallback for popup-blocked browsers).
  authFns.getRedirectResult?.(auth).catch((err) => {
    console.error("Redirect sign-in failed:", err);
    userRoleLabel.textContent = "Role: Sign-in failed (redirect)";
  });

  loginBtn.addEventListener("click", async () => {
    loginBtn.disabled = true;
    try {
      await authFns.signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Popup sign-in failed:", err);
      const code = err?.code || "";
      // Common browser issue: popup blocked or immediately closed.
      if (code.includes("popup")) {
        try {
          await authFns.signInWithRedirect?.(auth, provider);
          return;
        } catch (redirectErr) {
          console.error("Redirect fallback failed:", redirectErr);
        }
      }
      userRoleLabel.textContent = "Role: Sign-in failed";
      alert(`Sign in failed: ${code || err?.message || "Unknown error"}`);
    } finally {
      loginBtn.disabled = false;
    }
  });                                                                     

  logoutBtn.addEventListener("click", async () => {
    await authFns.signOut(auth);
  });

  authFns.onAuthStateChanged(auth, (user) => {
    if (!user) {
      userLabel.textContent = "Not signed in";
      userRoleLabel.textContent = "Role: —";
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      onSignedOut?.();
      return;
    }

    const email = user.email || "";
    const role = isAdminEmail?.(email) ? "SPED Admin" : "Teacher";

    userLabel.textContent = `${user.displayName || "User"} (${email})`;
    userRoleLabel.textContent = `Role: ${role}`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";

    onSignedIn?.(user, role);
  });
}
