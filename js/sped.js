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
  heatmap: document.getElementById("heatmap"),
  trendCanvas: document.getElementById("trendChart"),
  topCanvas: document.getElementById("topBehaviorsChart"),
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

function renderHeatmap(logs) {
  // day-of-week (0..6) x hour (0..23)
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));

  logs.forEach(l => {
    const dt = toDateFromCreatedAt(l);
    if (!dt) return;
    grid[dt.getDay()][dt.getHours()] += 1;
  });

  let max = 0;
  grid.forEach(row => row.forEach(v => { if (v > max) max = v; }));

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let html = `<div class="heatmap-grid">`;

  // header
  html += `<div class="heatmap-cell head"></div>`;
  for (let h = 0; h < 24; h++) html += `<div class="heatmap-cell head">${h}</div>`;

  for (let d = 0; d < 7; d++) {
    html += `<div class="heatmap-cell head">${dayNames[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = grid[d][h];
      const intensity = max ? (v / max) : 0;
      const opacity = 0.08 + intensity * 0.92;
      html += `
        <div class="heatmap-cell box" title="${dayNames[d]} ${h}:00 — ${v}"
             style="opacity:${opacity}">
          ${v ? v : ""}
        </div>
      `;
    }
  }

  html += `</div>`;
  els.heatmap.innerHTML = html;
}

function renderDashboard() {
  renderKpis(filteredLogs);
  renderTrendChart(filteredLogs);
  renderTopBehaviorsChart(filteredLogs);
  renderHeatmap(filteredLogs);
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
    els.heatmap.innerHTML = "";
  }
});
