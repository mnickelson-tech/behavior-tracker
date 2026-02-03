// js/auth-ui.js
import { auth, provider, authFns } from "./firebase-init.js";

export function wireAuthUI({ onSignedIn, onSignedOut, isAdminEmail }) {
  const userLabel = document.getElementById("userLabel");
  const userRoleLabel = document.getElementById("userRoleLabel");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  loginBtn.addEventListener("click", async () => {
    await authFns.signInWithPopup(auth, provider);
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
