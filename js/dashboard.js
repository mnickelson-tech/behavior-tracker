import { db, fb } from "./firebase-init.js";
import { wireAuthUI } from "./auth-ui.js";

// ✅ Same allowlist style as sped.js
const SPED_ADMIN_EMAILS = [
  "ektodd@conroeisd.net",
  "mhenthorn@conroeisd.net",
  "dpreuss@conroeisd.net",
  "mnickelson@conroeisd.net"
].map(e => e.toLowerCase());

function isAdminEmail(email) {
  return SPED_ADMIN_EMAILS.includes((email || "").toLowerCase());
}

let user = null;
let allLogs = [];      // fetched logs within date range
let filteredLogs = []; // after dropdown filters

let trendChart = null;
let topChart = null;

const els = {
  noAccessPanel: document.getElementById("noAccessPanel"),
  dashboardPanel: document.getElementById("dashboardPanel"),
  kpiPanel: document.getElementById("kpiPanel"),
  chartsPanel: document.getElementById("chartsPanel"),

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

function showPanelsForRole(role) {
  const isAdmin = role === "SPED Admin";
  els.noAccessPanel.style.display = isAdmin ? "none" : "block";
  els.dashboardPanel.style.display = isAdmin ? "block" : "none";
  els.kpiPanel.style.display = isAdmin ? "block" : "none";
  els.chartsPanel.style.display = isAdmin ? "block" : "none";
}

async function fetchLogsForRange(startDt, endDt) {
  // Use createdAt range so we don’t pull the entire year at once.
  // Range on createdAt works without composite indexes.
  const startTs = fb.Timestamp.fromDate(startDt);
  const endTs = fb.Timestamp.fromDate(endDt);

  const q = fb.query(
    fb.collection(db, "logs"),
    fb.where("createdAt", ">=", startTs),
    fb.where("createdAt", "<=", endTs)
  );

  const snap = await fb.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function rebuildFilterOptions(logs) {
  const students = new Set();
  const categories = new Set();
  const teachers = new Set();

  logs.forEach(l => {
    if (l.studentName) students.add(l.studentName);
    if (l.category) categories.add(l.category);
    if (l.teacherEmail) teachers.add(l.teacherEmail);
  });

  const fillSelect = (selectEl, values, allLabel) => {
    const current = selectEl.value;
    selectEl.innerHTML = `<option value="">${allLabel}</option>` +
      [...values].sort().map(v => `<option value="${encodeURIComponent(v)}">${v}</option>`).join("");
    // restore if still exists
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

function buildTopBehaviors(logs, topN = 10) {
  const counts = new Map();
  logs.forEach(l => {
    const key = l.behaviorName || l.behavior_type || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, topN);
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
      plugins: { legend: { display: true } },
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
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function renderHeatmap(logs) {
  // Build counts by day-of-week (0..6) x hour (0..23)
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));

  logs.forEach(l => {
    const dt = toDateFromCreatedAt(l);
    if (!dt) return;
    const dow = dt.getDay(); // 0 Sun
    const hr = dt.getHours();
    grid[dow][hr] += 1;
  });

  let max = 0;
  grid.forEach(row => row.forEach(v => { if (v > max) max = v; }));

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Build HTML heatmap with inline opacity (no extra libs)
  let html = `<div class="heatmap-grid">`;

  // header row
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

function renderAll() {
  renderKpis(filteredLogs);
  renderTrendChart(filteredLogs);
  renderTopBehaviorsChart(filteredLogs);
  renderHeatmap(filteredLogs);
}

function setDefaultDates() {
  const { start, end } = defaultDateRange();
  els.startDate.value = yyyyMmDd(start);
  els.endDate.value = yyyyMmDd(end);
}

async function loadAndRender() {
  const startDt = parseDateInput(els.startDate.value) || defaultDateRange().start;
  const endDt = parseDateInput(els.endDate.value, true) || defaultDateRange().end;

  allLogs = await fetchLogsForRange(startDt, endDt);
  rebuildFilterOptions(allLogs);
  applyDropdownFilters();
  renderAll();
}

// Filter buttons
els.applyBtn.addEventListener("click", async () => {
  await loadAndRender();
});

els.resetBtn.addEventListener("click", async () => {
  setDefaultDates();
  els.studentFilter.value = "";
  els.categoryFilter.value = "";
  els.teacherFilter.value = "";
  await loadAndRender();
});

// Auth wiring
wireAuthUI({
  isAdminEmail,
  onSignedIn: async (u, role) => {
    user = u;
    showPanelsForRole(role);

    if (role === "SPED Admin") {
      setDefaultDates();
      await loadAndRender();
    }
  },
  onSignedOut: () => {
    user = null;
    els.noAccessPanel.style.display = "none";
    els.dashboardPanel.style.display = "none";
    els.kpiPanel.style.display = "none";
    els.chartsPanel.style.display = "none";
    if (trendChart) trendChart.destroy();
    if (topChart) topChart.destroy();
    els.kpiGrid.innerHTML = "";
    els.heatmap.innerHTML = "";
  }
});
