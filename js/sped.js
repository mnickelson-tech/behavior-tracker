// js/sped.js
import { db, fb } from "./firebase-init.js";
import { wireAuthUI } from "./auth-ui.js";

/**
 * ✅ SPED Admin allowlist
 * Make sure commas are between emails.
 */
const SPED_ADMIN_EMAILS = [
  "ektodd@conroeisd.net",
  "mhenthorn@conroeisd.net",
  "dpreuss@conroeisd.net",
  "mnickelson@conroeisd.net"
].map(e => e.toLowerCase());

function isAdminEmail(email) {
  return SPED_ADMIN_EMAILS.includes((email || "").toLowerCase());
}

const BEHAVIORS_COL = "behaviors";
const LOGS_COL = "logs";

let user = null;

// Admin view data
let behaviors = [];
let unsubscribeBehaviors = null;

// Dashboard data
let allLogs = [];
let filteredLogs = [];
let trendChart = null;
let topChart = null;

const els = {
  // Panels / tabs
  noAccessPanel: document.getElementById("noAccessPanel"),
  spedTabs: document.getElementById("spedTabs"),
  adminView: document.getElementById("adminView"),
  dashView: document.getElementById("dashView"),
  tabAdmin: document.getElementById("tabAdmin"),
  tabDash: document.getElementById("tabDash"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),

  // Admin controls
  newBehaviorName: document.getElementById("newBehaviorName"),
  newBehaviorCategory: document.getElementById("newBehaviorCategory"),
  addBehaviorBtn: document.getElementById("addBehaviorBtn"),
  behaviorAdminList: document.getElementById("behaviorAdminList"),

  // Dashboard controls
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  studentFilter: document.getElementById("studentFilter"),
  categoryFilter: document.getElementById("categoryFilter"),
  teacherFilter: document.getElementById("teacherFilter"),
  applyBtn: document.getElementById("applyBtn"),
  resetBtn: document.getElementById("resetBtn"),
  kpiGrid: document.getElementById("kpiGrid"),
  notesPanel: document.getElementById("notesPanel"),
  trendCanvas: document.getElementById("trendChart"),
  topCanvas: document.getElementById("topBehaviorsChart"),
  studentDetailModal: document.getElementById("studentDetailModal"),
  studentDetailTitle: document.getElementById("studentDetailTitle"),
  studentDetailStats: document.getElementById("studentDetailStats"),
  studentDetailTimeline: document.getElementById("studentDetailTimeline"),
  studentDetailBehaviors: document.getElementById("studentDetailBehaviors"),
  studentDetailNotes: document.getElementById("studentDetailNotes"),
  closeStudentDetailBtn: document.getElementById("closeStudentDetailBtn"),
};

/* ---------------------------
   Tabs + visibility helpers
---------------------------- */

function setActiveTab(tab) {
  const isAdminTab = tab === "admin";

  els.adminView.style.display = isAdminTab ? "block" : "none";
  els.dashView.style.display = isAdminTab ? "none" : "block";

  // Button styles (simple swap)
  if (isAdminTab) {
    els.tabAdmin.classList.add("btn-blue");
    els.tabAdmin.classList.remove("btn-gray");
    els.tabDash.classList.add("btn-gray");
    els.tabDash.classList.remove("btn-blue");
  } else {
    els.tabDash.classList.add("btn-blue");
    els.tabDash.classList.remove("btn-gray");
    els.tabAdmin.classList.add("btn-gray");
    els.tabAdmin.classList.remove("btn-blue");
  }
}

els.tabAdmin?.addEventListener("click", () => setActiveTab("admin"));
els.tabDash?.addEventListener("click", async () => {
  setActiveTab("dash");
  // Lazy load dashboard when they click it
  await ensureDashboardLoaded();
});

/* ---------------------------
   Admin: Behaviors management
---------------------------- */

function renderAdminList() {
  if (!behaviors.length) {
    els.behaviorAdminList.innerHTML = `<div class="admin-row muted">No behaviors yet.</div>`;
    return;
  }

  const sorted = behaviors.slice().sort((a, b) => {
    const ac = (a.category || "Other");
    const bc = (b.category || "Other");
    if (ac === bc) return (a.name || "").localeCompare(b.name || "");
    return ac.localeCompare(bc);
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

  // No orderBy to avoid index headaches
  const q = fb.query(fb.collection(db, BEHAVIORS_COL));
  unsubscribeBehaviors = fb.onSnapshot(
    q,
    (snap) => {
      behaviors = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => b.active !== false);
      renderAdminList();
      // If dashboard filters depend on categories, refresh options
      if (els.dashView.style.display !== "none") rebuildDashboardFilterOptions(allLogs);
    },
    (err) => console.error("Behaviors listener error:", err)
  );
}

els.addBehaviorBtn?.addEventListener("click", async () => {
  if (!user) return;
  if (!isAdminEmail(user.email)) return;

  const name = els.newBehaviorName.value.trim();
  const category = (els.newBehaviorCategory.value || "Other").trim();
  if (!name) return;

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

els.newBehaviorName?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") els.addBehaviorBtn.click();
});

/* ---------------------------
   Dashboard: date helpers
---------------------------- */

function yyyyMmDd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 13); // last 14 days
  return { start, end };
}

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  return dt;
}

function toDateFromCreatedAt(log) {
  if (log.createdAt && typeof log.createdAt.toDate === "function") return log.createdAt.toDate();
  return null;
}

function setDefaultDates() {
  const { start, end } = defaultDateRange();
  els.startDate.value = yyyyMmDd(start);
  els.endDate.value = yyyyMmDd(end);
}

/* ---------------------------
   Dashboard: fetch + filters
---------------------------- */

let dashboardLoadedOnce = false;

async function fetchLogsForRange(startDt, endDt) {
  // Requires firebase-init.js to export fb.where + fb.Timestamp
  const startTs = fb.Timestamp.fromDate(startDt);
  const endTs = fb.Timestamp.fromDate(endDt);

  const q = fb.query(
    fb.collection(db, LOGS_COL),
    fb.where("createdAt", ">=", startTs),
    fb.where("createdAt", "<=", endTs)
  );

  const snap = await fb.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function rebuildDashboardFilterOptions(logs) {
  const students = new Set();
  const categories = new Set();
  const teachers = new Set();

  logs.forEach(l => {
    if (l.studentName) students.add(l.studentName);
    if (l.category) categories.add(l.category);
    if (l.teacherEmail) teachers.add(l.teacherEmail);
  });

  // Also include categories from behaviors list (nice UX)
  behaviors.forEach(b => {
    if (b.category) categories.add(b.category);
  });

  const fillSelect = (selectEl, values, allLabel) => {
    const current = selectEl.value;
    selectEl.innerHTML =
      `<option value="">${allLabel}</option>` +
      [...values].sort().map(v => `<option value="${encodeURIComponent(v)}">${v}</option>`).join("");
    if (current) selectEl.value = current;
  };

  fillSelect(els.studentFilter, students, "All students");
  fillSelect(els.categoryFilter, categories, "All categories");
  fillSelect(els.teacherFilter, teachers, "All teachers");
}

function applyDropdownFilters() {
  const student = decodeURIComponent(els.studentFilter.value || "");
  const category = decodeURIComponent(els.categoryFilter.value || "");
  const teacher = decodeURIComponent(els.teacherFilter.value || "");

  filteredLogs = allLogs.filter(l => {
    if (student && l.studentName !== student) return false;
    if (category && l.category !== category) return false;
    if (teacher && l.teacherEmail !== teacher) return false;
    return true;
  });
}

async function loadDashboardData() {
  const startDt = parseDateInput(els.startDate.value) || defaultDateRange().start;
  const endDt = parseDateInput(els.endDate.value, true) || defaultDateRange().end;

  allLogs = await fetchLogsForRange(startDt, endDt);
  rebuildDashboardFilterOptions(allLogs);
  applyDropdownFilters();
  renderDashboard();
}

async function ensureDashboardLoaded() {
  if (!dashboardLoadedOnce) {
    setDefaultDates();
    await loadDashboardData();
    dashboardLoadedOnce = true;
  } else {
    // still re-render to reflect any filter changes
    applyDropdownFilters();
    renderDashboard();
  }
}

/* ---------------------------
   Dashboard: render KPIs + charts
---------------------------- */

function renderKpis(logs) {
  const total = logs.length;

  const studentSet = new Set();
  const teacherSet = new Set();
  const behaviorCounts = new Map();

  logs.forEach(l => {
    if (l.studentName) studentSet.add(l.studentName);
    if (l.teacherEmail) teacherSet.add(l.teacherEmail);
    const key = l.behaviorName || l.behavior_type || "Unknown";
    behaviorCounts.set(key, (behaviorCounts.get(key) || 0) + 1);
  });

  let topBehavior = "—";
  let topCount = 0;
  for (const [k, v] of behaviorCounts.entries()) {
    if (v > topCount) { topBehavior = k; topCount = v; }
  }

  const cards = [
    { label: "Total incidents", value: total },
    { label: "Students impacted", value: studentSet.size },
    { label: "Teachers logging", value: teacherSet.size },
    { label: "Top behavior", value: total ? `${topBehavior} (${topCount})` : "—" }
  ];

  els.kpiGrid.innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="muted">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
    </div>
  `).join("");
}

function groupCountsByDay(logs) {
  const map = new Map(); // yyyy-mm-dd -> count
  logs.forEach(l => {
    const dt = toDateFromCreatedAt(l);
    const day = dt ? yyyyMmDd(dt) : (l.dayKey || "unknown");
    map.set(day, (map.get(day) || 0) + 1);
  });

  const labels = [...map.keys()].sort();
  const data = labels.map(d => map.get(d));
  return { labels, data };
}

function buildTopBehaviors(logs, topN = 12) {
  const counts = new Map();
  logs.forEach(l => {
    const key = l.behaviorName || l.behavior_type || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  return { labels: sorted.map(x => x[0]), data: sorted.map(x => x[1]) };
}

function renderTrendChart(logs) {
  const { labels, data } = groupCountsByDay(logs);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(els.trendCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Incidents", data, tension: 0.25 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function renderTopBehaviorsChart(logs) {
  const { labels, data } = buildTopBehaviors(logs, 12);

  if (topChart) topChart.destroy();
  topChart = new Chart(els.topCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Count", data }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function renderNotes(logs) {
  // Filter logs with notes
  const logsWithNotes = logs
    .filter(l => l.notes && l.notes.trim())
    .sort((a, b) => {
      // Sort by date descending (most recent first)
      const aDate = toDateFromCreatedAt(a)?.getTime() || 0;
      const bDate = toDateFromCreatedAt(b)?.getTime() || 0;
      return bDate - aDate;
    })
    .slice(0, 50); // Show top 50 most recent notes

  if (!logsWithNotes.length) {
    els.notesPanel.innerHTML = `<div class="muted">No notes recorded.</div>`;
    return;
  }

  els.notesPanel.innerHTML = logsWithNotes.map(l => {
    const dt = toDateFromCreatedAt(l);
    const date = dt ? dt.toLocaleDateString("en-US") : (l.dayKey || "");
    const time = dt ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";

    return `
      <div style="border-left: 3px solid #007bff; padding: 12px; margin-bottom: 12px; background: #f8f9fa; border-radius: 4px; cursor: pointer; transition: all 0.2s;" class="note-card" data-student="${encodeURIComponent(l.studentName)}">
        <div style="font-weight: 600; margin-bottom: 4px;">${l.studentName} — ${l.behaviorName}</div>
        <div class="muted" style="font-size: 13px; margin-bottom: 8px;">${date} at ${time}</div>
        <div style="font-style: italic; line-height: 1.4;">"${l.notes}"</div>
      </div>
    `;
  }).join("");

  // Add click handlers to open student detail
  els.notesPanel.querySelectorAll(".note-card").forEach(card => {
    card.addEventListener("click", () => {
      const student = decodeURIComponent(card.dataset.student);
      showStudentDetail(student, allLogs);
    });
    card.addEventListener("mouseover", () => {
      card.style.background = "#eef2ff";
      card.style.transform = "translateX(4px)";
    });
    card.addEventListener("mouseout", () => {
      card.style.background = "#f8f9fa";
      card.style.transform = "translateX(0)";
    });
  });
}

function showStudentDetail(studentName, logs) {
  // Filter logs for this student
  const studentLogs = logs.filter(l => l.studentName === studentName)
    .sort((a, b) => {
      const aDate = toDateFromCreatedAt(a)?.getTime() || 0;
      const bDate = toDateFromCreatedAt(b)?.getTime() || 0;
      return bDate - aDate;
    });

  if (!studentLogs.length) {
    return;
  }

  // Stats
  const totalIncidents = studentLogs.length;
  const uniqueBehaviors = new Set(studentLogs.map(l => l.behaviorName || "Unknown")).size;
  const firstDate = studentLogs[studentLogs.length - 1];
  const lastDate = studentLogs[0];
  const firstDateStr = toDateFromCreatedAt(firstDate)?.toLocaleDateString() || "";
  const lastDateStr = toDateFromCreatedAt(lastDate)?.toLocaleDateString() || "";

  els.studentDetailTitle.textContent = studentName;
  els.studentDetailStats.textContent = `${totalIncidents} incidents | ${uniqueBehaviors} behavior types | ${firstDateStr} to ${lastDateStr}`;

  // Timeline
  const timeline = studentLogs.slice(0, 30).map(l => {
    const dt = toDateFromCreatedAt(l);
    const date = dt ? dt.toLocaleDateString("en-US") : (l.dayKey || "");
    const time = dt ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
    const noteHtml = l.notes ? `<div class="muted" style="margin-top: 6px; font-size: 12px; font-style: italic; padding: 6px; background: #f0f4ff; border-radius: 4px;">📝 ${l.notes}</div>` : "";

    return `
      <div style="border-left: 3px solid #667eea; padding: 12px; margin-bottom: 12px; background: #f8f9fa; border-radius: 4px;">
        <div style="font-weight: 600;">${l.behaviorName}</div>
        <div class="muted" style="font-size: 12px;">${date} at ${time} • ${l.teacherEmail || "Unknown teacher"}</div>
        ${noteHtml}
      </div>
    `;
  }).join("");

  els.studentDetailTimeline.innerHTML = timeline || `<div class="muted">No incidents recorded.</div>`;

  // Behavior breakdown
  const behaviorCounts = new Map();
  studentLogs.forEach(l => {
    const key = l.behaviorName || "Unknown";
    behaviorCounts.set(key, (behaviorCounts.get(key) || 0) + 1);
  });

  const behaviorBreakdown = [...behaviorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([behavior, count]) => {
      const pct = Math.round((count / totalIncidents) * 100);
      return `
        <div style="padding: 8px; background: #f8f9fa; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span>${behavior}</span>
          <span style="font-weight: 600;">${count} (${pct}%)</span>
        </div>
      `;
    }).join("");

  els.studentDetailBehaviors.innerHTML = behaviorBreakdown;

  // Notable notes
  const notes = studentLogs
    .filter(l => l.notes && l.notes.trim())
    .slice(0, 10)
    .map(l => {
      const dt = toDateFromCreatedAt(l);
      const dateStr = dt ? dt.toLocaleDateString("en-US") : "";
      return `
        <div style="padding: 10px; background: #fffbf0; border-left: 3px solid #f6ad55; border-radius: 4px; margin-bottom: 8px;">
          <div style="font-weight: 600; font-size: 12px; color: #c05621;">${l.behaviorName} • ${dateStr}</div>
          <div style="margin-top: 4px; font-style: italic;">${l.notes}</div>
        </div>
      `;
    }).join("");

  els.studentDetailNotes.innerHTML = notes || `<div class="muted">No notes recorded for this student.</div>`;

  // Show modal
  els.studentDetailModal.style.display = "flex";
  els.studentDetailModal.style.justifyContent = "center";
  els.studentDetailModal.style.alignItems = "center";
}


function renderDashboard() {
  renderKpis(filteredLogs);
  renderTrendChart(filteredLogs);
  renderTopBehaviorsChart(filteredLogs);
  renderNotes(filteredLogs);
}

/* ---------------------------
   CSV Export (fixed columns)
---------------------------- */

async function exportLogsToCsv() {
  // Export within selected date range + dropdown filters
  const startDt = parseDateInput(els.startDate.value) || defaultDateRange().start;
  const endDt = parseDateInput(els.endDate.value, true) || defaultDateRange().end;

  const logs = await fetchLogsForRange(startDt, endDt);

  // Apply dropdown filters to export too
  const student = decodeURIComponent(els.studentFilter.value || "");
  const category = decodeURIComponent(els.categoryFilter.value || "");
  const teacher = decodeURIComponent(els.teacherFilter.value || "");

  const filtered = logs.filter(l => {
    if (student && l.studentName !== student) return false;
    if (category && l.category !== category) return false;
    if (teacher && l.teacherEmail !== teacher) return false;
    return true;
  });

  const headers = ["date", "time", "studentInitials", "behavior", "category", "teacherEmail"];
  const rows = [headers.join(",")];

  const esc = (v) => {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };

  filtered.forEach(l => {
    const dt = toDateFromCreatedAt(l);
    const date = dt ? dt.toLocaleDateString("en-US") : (l.dayKey || "");
    const time = dt ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

    const studentInit = l.studentName || "";
    const behavior = l.behaviorName || l.behavior_type || "";
    const cat = l.category || l.behaviorCategory || "";
    const teacherEmail = l.teacherEmail || "";

    rows.push([
      esc(date),
      esc(time),
      esc(studentInit),
      esc(behavior),
      esc(cat),
      esc(teacherEmail)
    ].join(","));
  });

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `behavior_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.exportCsvBtn?.addEventListener("click", async () => {
  if (!user) return;
  if (!isAdminEmail(user.email)) return;
  await exportLogsToCsv();
});

/* ---------------------------
   Dashboard filter buttons
---------------------------- */

els.applyBtn?.addEventListener("click", async () => {
  if (!user) return;
  if (!isAdminEmail(user.email)) return;
  await loadDashboardData();
});

els.resetBtn?.addEventListener("click", async () => {
  if (!user) return;
  if (!isAdminEmail(user.email)) return;

  setDefaultDates();
  els.studentFilter.value = "";
  els.categoryFilter.value = "";
  els.teacherFilter.value = "";
  await loadDashboardData();
});

/* ---------------------------
   Student Detail Modal handlers
---------------------------- */

els.closeStudentDetailBtn?.addEventListener("click", () => {
  els.studentDetailModal.style.display = "none";
});

// Close modal when clicking outside the inner div
els.studentDetailModal?.addEventListener("click", (e) => {
  if (e.target === els.studentDetailModal) {
    els.studentDetailModal.style.display = "none";
  }
});

// Also make student names in the dashboard clickable
function makeStudentNamesClickable(container) {
  const studentElements = container.querySelectorAll("[data-student-click]");
  studentElements.forEach(el => {
    el.style.cursor = "pointer";
    el.style.color = "#667eea";
    el.style.textDecoration = "underline";
    el.addEventListener("click", () => {
      const student = el.dataset.studentClick;
      showStudentDetail(student, allLogs);
    });
  });
}

/* ---------------------------
   Auth wiring
---------------------------- */

wireAuthUI({
  isAdminEmail,
  onSignedIn: async (u, role) => {
    user = u;

    const isAdmin = role === "SPED Admin";

    els.noAccessPanel.style.display = isAdmin ? "none" : "block";
    els.spedTabs.style.display = isAdmin ? "block" : "none";
    els.adminView.style.display = isAdmin ? "block" : "none";
    els.dashView.style.display = "none"; // default: admin tab

    if (!isAdmin) {
      if (unsubscribeBehaviors) unsubscribeBehaviors();
      return;
    }

    // Start listeners and set default tab
    startBehaviorsListener();
    setActiveTab("admin");

    // Pre-set dates so export/dashboard have sane defaults
    setDefaultDates();
  },

  onSignedOut: () => {
    user = null;
    behaviors = [];
    allLogs = [];
    filteredLogs = [];
    dashboardLoadedOnce = false;

    if (unsubscribeBehaviors) unsubscribeBehaviors();
    unsubscribeBehaviors = null;

    els.noAccessPanel.style.display = "none";
    els.spedTabs.style.display = "none";
    els.adminView.style.display = "none";
    els.dashView.style.display = "none";

    if (trendChart) trendChart.destroy();
    if (topChart) topChart.destroy();
    trendChart = null;
    topChart = null;

    els.behaviorAdminList.innerHTML = "";
    els.kpiGrid.innerHTML = "";
    els.notesPanel.innerHTML = "";
  }
});
