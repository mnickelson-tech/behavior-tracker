// js/sped.js
import { db, fb } from "./firebase-init.js";
import { wireAuthUI } from "./auth-ui.js";

// ✅ PUT YOUR SPED ADMIN EMAILS HERE
const SPED_ADMIN_EMAILS = [
  ektodd@conroeisd.net
  mhenthorn@conroeisd.net
  dpreuss@conroeisd.net
  mnickelson@conroeisd.net
].map(e => e.toLowerCase());

const BEHAVIORS_COL = "behaviors";

let user = null;
let behaviors = [];
let unsubscribeBehaviors = null;

const els = {
  adminPanel: document.getElementById("adminPanel"),
  noAccessPanel: document.getElementById("noAccessPanel"),
  newBehaviorName: document.getElementById("newBehaviorName"),
  newBehaviorCategory: document.getElementById("newBehaviorCategory"),
  addBehaviorBtn: document.getElementById("addBehaviorBtn"),
  behaviorAdminList: document.getElementById("behaviorAdminList"),
};

function isAdminEmail(email) {
  return SPED_ADMIN_EMAILS.includes((email || "").toLowerCase());
}

function renderAdminList() {
  if (!behaviors.length) {
    els.behaviorAdminList.innerHTML = `<div class="admin-row muted">No behaviors yet.</div>`;
    return;
  }

  const sorted = behaviors.slice().sort((a,b) => {
    if ((a.category||"") === (b.category||"")) return (a.name||"").localeCompare(b.name||"");
    return (a.category||"").localeCompare(b.category||"");
  });

  els.behaviorAdminList.innerHTML = sorted.map(b => `
    <div class="admin-row">
      <div>
        <div style="font-weight:900;">${b.name}</div>
        <div class="badge">${b.category || "Other"}</div>
      </div>
      <button class="btn btn-danger" data-del="${b.id}">Delete</button>
    </div>
  `).join("");

  els.behaviorAdminList.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.del;
      await fb.deleteDoc(fb.doc(db, BEHAVIORS_COL, id));
    });
  });
}

function startBehaviorsListener() {
  if (unsubscribeBehaviors) unsubscribeBehaviors();

  const q = fb.query(fb.collection(db, BEHAVIORS_COL), fb.orderBy("category"), fb.orderBy("name"));
  unsubscribeBehaviors = fb.onSnapshot(q, (snap) => {
    behaviors = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.active !== false);
    renderAdminList();
  });
}

els.addBehaviorBtn.addEventListener("click", async () => {
  if (!user) return;
  if (!isAdminEmail(user.email)) return;

  const name = els.newBehaviorName.value.trim();
  const category = els.newBehaviorCategory.value.trim() || "Other";
  if (!name) return;

  // prevent duplicates by name (case-insensitive)
  const exists = behaviors.some(b => (b.name || "").toLowerCase() === name.toLowerCase());
  if (exists) return;

  await fb.addDoc(fb.collection(db, BEHAVIORS_COL), {
    name,
    category,
    active: true,
    updatedAt: fb.serverTimestamp(),
    updatedBy: user.email || ""
  });

  els.newBehaviorName.value = "";
});

els.newBehaviorName.addEventListener("keypress", (e) => {
  if (e.key === "Enter") els.addBehaviorBtn.click();
});

wireAuthUI({
  isAdminEmail,
  onSignedIn: (u, role) => {
    user = u;
    if (role === "SPED Admin") {
      els.adminPanel.style.display = "block";
      els.noAccessPanel.style.display = "none";
      startBehaviorsListener();
    } else {
      els.adminPanel.style.display = "none";
      els.noAccessPanel.style.display = "block";
      if (unsubscribeBehaviors) unsubscribeBehaviors();
    }
  },
  onSignedOut: () => {
    user = null;
    behaviors = [];
    if (unsubscribeBehaviors) unsubscribeBehaviors();
    els.adminPanel.style.display = "none";
    els.noAccessPanel.style.display = "none";
  }
});
