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
  notesPanel: document.getElementById("notesPanel"),

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

function renderAll() {
  renderKpis(filteredLogs);
  renderTrendChart(filteredLogs);
  renderTopBehaviorsChart(filteredLogs);
  renderNotes(filteredLogs);
}

function renderNotes(logs) {
  const logsWithNotes = logs
    .filter(l => l.notes && l.notes.trim())
    .sort((a, b) => {
      const aDate = toDateFromCreatedAt(a)?.getTime() || 0;
      const bDate = toDateFromCreatedAt(b)?.getTime() || 0;
      return bDate - aDate;
    })
    .slice(0, 50);

  if (!logsWithNotes.length) {
    els.notesPanel.innerHTML = `<div class="muted">No notes recorded.</div>`;
    return;
  }

  els.notesPanel.innerHTML = logsWithNotes.map(l => {
    const dt = toDateFromCreatedAt(l);
    const date = dt ? dt.toLocaleDateString("en-US") : (l.dayKey || "");
    const time = dt ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";

    return `
      <div style="border-left: 3px solid #007bff; padding: 12px; margin-bottom: 12px; background: #f8f9fa; border-radius: 4px;">
        <div style="font-weight: 600; margin-bottom: 4px;">${l.studentName} — ${l.behaviorName}</div>
        <div class="muted" style="font-size: 13px; margin-bottom: 8px;">${date} at ${time}</div>
        <div style="font-style: italic; line-height: 1.4;">"${l.notes}"</div>
      </div>
    `;
  }).join("");
}
    user = null;
    els.noAccessPanel.style.display = "none";
    els.dashboardPanel.style.display = "none";
    els.kpiPanel.style.display = "none";
    els.chartsPanel.style.display = "none";
    if (trendChart) trendChart.destroy();
    if (topChart) topChart.destroy();
    els.kpiGrid.innerHTML = "";
    els.notesPanel.innerHTML = "";
  }
});
