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

const els = {
  studentButtons: document.getElementById("studentButtons"),
  studentInput: document.getElementById("studentInput"),
  addStudentBtn: document.getElementById("addStudentBtn"),
  currentStudentBox: document.getElementById("currentStudentBox"),
  currentStudentName: document.getElementById("currentStudentName"),
  noStudentWarning: document.getElementById("noStudentWarning"),
  behaviorGrid: document.getElementById("behaviorGrid"),
  todayLog: document.getElementById("todayLog"),
};

function normalizeStudentInitials(input) {
  const raw = (input || "").trim();
  if (!raw) return "";

  const parts = raw
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1 && parts[0].length > 1) {
    const letters = parts[0].replace(/[^a-zA-Z]/g, "");
    if (letters.length >= 2 && letters.length <= 4) {
      return letters
        .toUpperCase()
        .split("")
        .map(ch => `${ch}.`)
        .join("");
    }
  }

  return parts
    .slice(0, 3)
    .map(p => p[0].toUpperCase())
    .map(ch => `${ch}.`)
    .join("");
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

  els.behaviorGrid.querySelectorAll(".behavior-btn").forEach(btn => {
    btn.disabled = !currentStudent;
  });
}

function renderGradeTabs() {
  const wrap = document.getElementById("gradeTabs");
  if (!wrap) return;

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

  const sections = Object.keys(byCat).sort().map(cat => {
    const items = byCat[cat]
      .sort((a,b) => (a.name || "").localeCompare(b.name || ""))
      .map(b => `
        <button class="behavior-btn" data-id="${b.id}" ${!currentStudent ? "disabled" : ""}>
          <span>${b.name}</span>
        </button>
      `).join("");

    return `
      <div style="margin-bottom:12px;">
        <div class="muted" style="margin: 0 0 8px;">${cat}</div>
        <div class="behavior-grid">${items}</div>
      </div>
    `;
  }).join("");

  els.behaviorGrid.innerHTML = sections;

  els.behaviorGrid.querySelectorAll(".behavior-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!user || !currentStudent) return;
      const behavior = behaviors.find(b => b.id === btn.dataset.id);
      if (!behavior) return;

      await fb.addDoc(fb.collection(db, LOGS_COL), {
        dayKey: todayKey(),
        grade: selectedGrade,              // ✅ add grade to logs
        studentName: currentStudent,       // initials
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

  els.todayLog.innerHTML = logDocs.map(d => {
    const l = d.data();
    const time = l.createdAt?.toDate
      ? l.createdAt.toDate().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "…";

    return `
      <div class="log-item">
        <div><strong>${l.studentName}</strong> — ${l.behaviorName}</div>
        <div class="muted">${time}</div>
      </div>
    `;
  }).join("");
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

// Auth wiring
wireAuthUI({
  isAdminEmail: () => false,
  onSignedIn: async (u) => {
    user = u;
    renderGradeTabs();     // ✅ tabs show
    await loadStudents();
    startBehaviorListener();
    startTodayLogsListener();
  },
  onSignedOut: () => {
    user = null;
    students = [];
    behaviors = [];
    currentStudent = null;

    if (unsubscribeBehaviors) unsubscribeBehaviors();
    if (unsubscribeTodayLogs) unsubscribeTodayLogs();

    els.studentButtons.innerHTML = "";
    els.behaviorGrid.innerHTML = "";
    els.todayLog.innerHTML = `<div class="log-item muted">Sign in to view logs.</div>`;
    updateStudentState();
  }
});
