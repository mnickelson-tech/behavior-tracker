// js/teacher.js
import { db, fb } from "./firebase-init.js";
import { wireAuthUI } from "./auth-ui.js";

// ✅ Your fb wrapper doesn't include getDoc, so import it directly
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Collection paths
const BEHAVIORS_COL = "behaviors";
const LOGS_COL = "logs";

// ✅ IMPORTANT: make students per-teacher so they don't see each other
const STUDENTS_DOC = (uid) => `teacherStudents/${uid}`;

// Grades
const GRADE_OPTIONS = ["PK","K","1","2","3","4","5","6"];
let selectedGrade = "K";

let user = null;
let students = [];
let behaviors = [];
let currentStudent = null;
let unsubscribeBehaviors = null;
let unsubscribeTodayLogs = null;
let todayLogDocs = [];
let pendingNoteDocId = null;
let favorites = []; // Array of behavior IDs that are favorited

const els = {
  studentButtons: document.getElementById("studentButtons"),
  studentInput: document.getElementById("studentInput"),
  addStudentBtn: document.getElementById("addStudentBtn"),
  currentStudentBox: document.getElementById("currentStudentBox"),
  currentStudentName: document.getElementById("currentStudentName"),
  noStudentWarning: document.getElementById("noStudentWarning"),
  behaviorGrid: document.getElementById("behaviorGrid"),
  todayLog: document.getElementById("todayLog"),
  notesModal: document.getElementById("notesModal"),
  notesInput: document.getElementById("notesInput"),
  notesModalTitle: document.getElementById("notesModalTitle"),
  notesSaveBtn: document.getElementById("notesSaveBtn"),
  notesCancelBtn: document.getElementById("notesCancelBtn"),
};

function normalizeStudentInitials(input) {
  const raw = (input || "").trim();
  if (!raw) return "";

  const parts = raw
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "";

  // First 2 letters of first name
  const firstName = parts[0].substring(0, 2).toUpperCase();
  
  // First 3 letters of last name (if it exists)
  if (parts.length >= 2) {
    const lastName = parts[1].substring(0, 3).toUpperCase();
    return firstName + lastName;
  }
  
  // If no last name, just return first name (2 letters)
  return firstName;
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function updateStudentState() {
  if (currentStudent) {
    els.currentStudentBox.style.display = "block";
    els.noStudentWarning.style.display = "none";
    els.currentStudentName.textContent = currentStudent;
  } else {
    els.currentStudentBox.style.display = "none";
    els.noStudentWarning.style.display = "block";
  }

  // Update behavior button states (now divs instead of buttons)
  els.behaviorGrid.querySelectorAll(".behavior-btn").forEach(btn => {
    if (!currentStudent) {
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
      btn.style.pointerEvents = "none";
    } else {
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.style.pointerEvents = "auto";
    }
  });
}

function renderGradeTabs() {
  const wrap = document.getElementById("gradeTabs");
  if (!wrap) {
    console.error("gradeTabs element not found!");
    return;
  }

  wrap.innerHTML = "";
  for (const g of GRADE_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "grade-tab" + (g === selectedGrade ? " active" : "");
    btn.textContent = g;

    btn.addEventListener("click", async () => {
      selectedGrade = g;
      renderGradeTabs();
      await loadStudents(); // ✅ reload students for this grade
    });

    wrap.appendChild(btn);
  }
  console.log("Grade tabs rendered:", GRADE_OPTIONS);
}

function renderStudents() {
  els.studentButtons.innerHTML = students.map(name => `
    <button class="student-btn ${currentStudent === name ? "active" : ""}" data-student="${encodeURIComponent(name)}">
      <span>${name}</span>
      <span class="small-x" data-del="${encodeURIComponent(name)}">✕</span>
    </button>
  `).join("");

  els.studentButtons.querySelectorAll(".student-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const del = e.target?.dataset?.del;
      if (del) return;

      const s = decodeURIComponent(btn.dataset.student);
      currentStudent = s;
      renderStudents();
      updateStudentState();
    });
  });

  els.studentButtons.querySelectorAll(".small-x").forEach(x => {
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!user) return;

      const s = decodeURIComponent(x.dataset.del);
      students = students.filter(n => n !== s);
      if (currentStudent === s) currentStudent = null;

      // write updated list back for this grade
      const docRef = fb.doc(db, STUDENTS_DOC(user.uid));
      const snap = await getDoc(docRef);
      const data = snap.exists() ? (snap.data() || {}) : {};
      const byGrade = data.studentsByGrade || {};
      byGrade[selectedGrade] = students;

      await fb.setDoc(
        docRef,
        { studentsByGrade: byGrade, updatedAt: fb.serverTimestamp() },
        { merge: true }
      );

      renderStudents();
      updateStudentState();
    });
  });
}

function renderBehaviors() {
  const byCat = {};
  for (const b of behaviors) {
    const cat = b.category || "Other";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(b);
  }

  // Render favorites first if any exist
  let favoritesHtml = "";
  const favoritesBehaviors = behaviors.filter(b => favorites.includes(b.id));
  if (favoritesBehaviors.length > 0) {
    const favItems = favoritesBehaviors.map(b => `
      <div class="behavior-btn" data-id="${b.id}" style="background: #fef3c7; border-color: #fcd34d; color: #92400e; font-weight: 900; display: flex; justify-content: space-between; align-items: center; padding: 14px; border-radius: 12px; border: 2px solid #fcd34d; cursor: pointer; transition: all 0.2s;">
        <div style="flex: 1; text-align: left;">⭐ ${b.name}</div>
        <span class="star-btn favorite" data-star-id="${b.id}" title="Remove from favorites" style="font-size: 18px; cursor: pointer;">★</span>
      </div>
    `).join("");

    favoritesHtml = `
      <div class="favorites-section">
        <h3>⭐ Favorites (Quick Access)</h3>
        <div class="favorites-grid">${favItems}</div>
      </div>
    `;
  }

  const sections = Object.keys(byCat).sort().map(cat => {
    const items = byCat[cat]
      .sort((a,b) => (a.name || "").localeCompare(b.name || ""))
      .map(b => {
        const isFavorited = favorites.includes(b.id);
        return `
        <div class="behavior-btn" data-id="${b.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 14px; border-radius: 12px; border: 2px solid var(--gray); background: #f7fafc; cursor: pointer; font-weight: 800; transition: all 0.2s;">
          <span>${b.name}</span>
          <span class="star-btn ${isFavorited ? "favorite" : "unfavorite"}" data-star-id="${b.id}" title="${isFavorited ? "Remove from favorites" : "Add to favorites"}" style="font-size: 18px; cursor: pointer;">★</span>
        </div>
      `;
      }).join("");

    return `
      <div style="margin-bottom:12px;">
        <div class="muted" style="margin: 0 0 8px;">${cat}</div>
        <div class="behavior-grid">${items}</div>
      </div>
    `;
  }).join("");

  els.behaviorGrid.innerHTML = favoritesHtml + sections;

  // Handle star button clicks (prevent triggering behavior log)
  els.behaviorGrid.querySelectorAll(".star-btn").forEach(starBtn => {
    starBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!user) return;
      
      const behaviorId = starBtn.dataset.starId;
      
      if (favorites.includes(behaviorId)) {
        // Remove from favorites
        favorites = favorites.filter(id => id !== behaviorId);
      } else {
        // Add to favorites
        favorites.push(behaviorId);
      }
      
      // Save to Firebase
      const docRef = fb.doc(db, `teacherFavorites/${user.uid}`);
      await fb.setDoc(
        docRef,
        { favoriteBehaviors: favorites, updatedAt: fb.serverTimestamp() },
        { merge: true }
      );
      
      renderBehaviors();
    });
  });

  els.behaviorGrid.querySelectorAll(".behavior-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      if (e.target.classList.contains("star-btn")) return;
      if (!user || !currentStudent) return;
      const behavior = behaviors.find(b => b.id === btn.dataset.id);
      if (!behavior) return;

      // Log immediately without modal
      await fb.addDoc(fb.collection(db, LOGS_COL), {
        dayKey: todayKey(),
        grade: selectedGrade,
        studentName: currentStudent,
        behaviorId: behavior.id,
        behaviorName: behavior.name,
        category: behavior.category || "Other",
        teacherUid: user.uid,
        teacherEmail: user.email || "",
        createdAt: fb.serverTimestamp()
      });
    });
  });

  updateStudentState();
}

function renderTodayLogs(logDocs) {
  if (!logDocs.length) {
    els.todayLog.innerHTML = `<div class="log-item muted">No logs yet today.</div>`;
    return;
  }

  todayLogDocs = logDocs;

  els.todayLog.innerHTML = logDocs.map((d, idx) => {
    const l = d.data();
    const time = l.createdAt?.toDate
      ? l.createdAt.toDate().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "…";

    const notesHtml = l.notes ? `<div class="muted" style="margin-top: 6px; font-size: 13px; font-style: italic;">📝 ${l.notes}</div>` : "";
    const addNoteBtn = idx < 5 ? `<button class="btn-add-note" data-idx="${idx}" style="margin-top: 8px; padding: 4px 8px; font-size: 12px;">+ Add Note</button>` : "";

    return `
      <div class="log-item">
        <div><strong>${l.studentName}</strong> — ${l.behaviorName}</div>
        <div class="muted">${time}</div>
        ${notesHtml}
        ${addNoteBtn}
      </div>
    `;
  }).join("");

  // Attach click handlers to add note buttons
  els.todayLog.querySelectorAll(".btn-add-note").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(btn.dataset.idx);
      const doc = todayLogDocs[idx];
      if (!doc) return;

      const l = doc.data();
      pendingNoteDocId = doc.id;
      els.notesModalTitle.textContent = `Add Note for "${l.behaviorName}"`;
      els.notesInput.value = l.notes || "";
      els.notesModal.style.display = "flex";
      els.notesInput.focus();
    });
  });
}

async function loadStudents() {
  if (!user) return;

  const docRef = fb.doc(db, STUDENTS_DOC(user.uid));
  const snap = await getDoc(docRef);

  const data = snap.exists() ? (snap.data() || {}) : {};
  const byGrade = data.studentsByGrade || {};

  students = byGrade[selectedGrade] || [];

  renderStudents();
  updateStudentState();
}

async function loadFavorites() {
  if (!user) return;
  
  try {
    const docRef = fb.doc(db, `teacherFavorites/${user.uid}`);
    const snap = await getDoc(docRef);
    
    if (snap.exists()) {
      favorites = snap.data().favoriteBehaviors || [];
    } else {
      favorites = [];
    }
  } catch (err) {
    console.error("Error loading favorites:", err);
    favorites = []; // Don't break if favorites fail
  }
}

function startBehaviorListener() {
  if (unsubscribeBehaviors) unsubscribeBehaviors();

  const q = fb.query(fb.collection(db, BEHAVIORS_COL));
  unsubscribeBehaviors = fb.onSnapshot(
    q,
    (snap) => {
      behaviors = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(b => b.active !== false);

      behaviors.sort((a, b) => {
        const ac = (a.category || "Other");
        const bc = (b.category || "Other");
        if (ac === bc) return (a.name || "").localeCompare(b.name || "");
        return ac.localeCompare(bc);
      });

      renderBehaviors();
    },
    (err) => console.error("Behavior listener error:", err)
  );
}

function startTodayLogsListener() {
  if (unsubscribeTodayLogs) unsubscribeTodayLogs();

  const q = fb.query(
    fb.collection(db, LOGS_COL),
    fb.orderBy("createdAt", "desc")
  );

  unsubscribeTodayLogs = fb.onSnapshot(q, (snap) => {
    // only today's logs AND only this teacher (teacher view)
    const docs = snap.docs
      .filter(d => d.data()?.dayKey === todayKey())
      .filter(d => d.data()?.teacherUid === user?.uid);

    renderTodayLogs(docs.slice(0, 50));
  });
}

// Add student (safe read -> write)
els.addStudentBtn.addEventListener("click", async () => {
  if (!user) return;

  const name = normalizeStudentInitials(els.studentInput.value);
  if (!name) return;

  currentStudent = name;
  els.studentInput.value = "";

  const docRef = fb.doc(db, STUDENTS_DOC(user.uid));
  const snap = await getDoc(docRef);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const byGrade = data.studentsByGrade || {};

  const list = byGrade[selectedGrade] || [];
  if (!list.includes(name)) list.push(name);
  byGrade[selectedGrade] = list;

  await fb.setDoc(
    docRef,
    { studentsByGrade: byGrade, updatedAt: fb.serverTimestamp() },
    { merge: true }
  );

  await loadStudents();
});

els.studentInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") els.addStudentBtn.click();
});

// Modal handlers for notes
els.notesSaveBtn.addEventListener("click", async () => {
  if (!user || !pendingNoteDocId) return;

  const notes = els.notesInput.value.trim();

  const docRef = fb.doc(db, LOGS_COL, pendingNoteDocId);
  await fb.updateDoc(docRef, {
    notes: notes || null
  });

  // Close modal
  els.notesModal.style.display = "none";
  pendingNoteDocId = null;
});

els.notesCancelBtn.addEventListener("click", () => {
  els.notesModal.style.display = "none";
  pendingNoteDocId = null;
});

// Close modal when clicking outside
els.notesModal.addEventListener("click", (e) => {
  if (e.target === els.notesModal) {
    els.notesModal.style.display = "none";
    pendingNoteDocId = null;
  }
});

// Auth wiring
wireAuthUI({
  isAdminEmail: () => false,
  onSignedIn: async (u) => {
    user = u;
    console.log("User signed in, rendering grade tabs...");
    await loadFavorites(); // ✅ Load favorites first
    renderGradeTabs();     // ✅ tabs show
    console.log("Grade tabs should now be visible");
    await loadStudents();
    startBehaviorListener();
    startTodayLogsListener();
  },
  onSignedOut: () => {
    user = null;
    students = [];
    behaviors = [];
    currentStudent = null;
    favorites = [];

    if (unsubscribeBehaviors) unsubscribeBehaviors();
    if (unsubscribeTodayLogs) unsubscribeTodayLogs();

    els.studentButtons.innerHTML = "";
    els.behaviorGrid.innerHTML = "";
    els.todayLog.innerHTML = `<div class="log-item muted">Sign in to view logs.</div>`;
    updateStudentState();
  }
});
