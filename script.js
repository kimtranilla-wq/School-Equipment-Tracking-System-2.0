"use strict";

// 1. Data
const STORAGE_KEYS = {
  equipment: "equipmentList",
  activities: "activityStack",
  maintenance: "maintenanceQueue",
  users: "normalUserAccounts",
  returnProofs: "returnProofs"
};
const SESSION_KEY = "equipmentTrackingSession";
const MAX_RETURN_PHOTO_SIZE = 20 * 1024 * 1024;
const STATUSES = ["Available", "In Use", "Under Maintenance", "Lost"];
const CONDITIONS = ["New", "Good", "Fair", "Damaged"];
const sampleEquipment = [
  { id: "EQ001", name: "Dell Laptop", category: "Computer", brand: "Dell", serialNumber: "DL001", quantity: 10, purchaseDate: "2026-01-15", purchasePrice: 35000, location: "Computer Laboratory", assignedTo: "IT Department", status: "Available", condition: "Good" },
  { id: "EQ002", name: "Epson Projector", category: "Projector", brand: "Epson", serialNumber: "EP001", quantity: 5, purchaseDate: "2025-08-20", purchasePrice: 28000, location: "Room 201", assignedTo: "Faculty", status: "In Use", condition: "Good" },
  { id: "EQ003", name: "HP Printer", category: "Printer", brand: "HP", serialNumber: "HP001", quantity: 3, purchaseDate: "2025-04-11", purchasePrice: 12000, location: "Administration Office", assignedTo: "Administration", status: "Under Maintenance", condition: "Fair" },
  { id: "EQ004", name: "Lenovo Desktop", category: "Computer", brand: "Lenovo", serialNumber: "LN001", quantity: 8, purchaseDate: "2026-02-03", purchasePrice: 32000, location: "Computer Laboratory", assignedTo: "IT Department", status: "Available", condition: "New" },
  { id: "EQ005", name: "BenQ Projector", category: "Projector", brand: "BenQ", serialNumber: "BQ001", quantity: 2, purchaseDate: "2024-09-16", purchasePrice: 26000, location: "Room 202", assignedTo: "Faculty", status: "Lost", condition: "Damaged" }
];

function loadArray(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.error(`Could not load ${key} from LocalStorage.`, error);
    return fallback;
  }
}

let equipmentList = loadArray(STORAGE_KEYS.equipment, sampleEquipment.map(record => ({ ...record })));
let activityStack = loadArray(STORAGE_KEYS.activities, []);
let maintenanceQueue = loadArray(STORAGE_KEYS.maintenance, []);
let userAccounts = loadArray(STORAGE_KEYS.users, []);
let returnProofs = loadArray(STORAGE_KEYS.returnProofs, []);
let currentUser = null;
let toastTimer;
let lastFocusedElement = null;

// 2. LocalStorage
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(equipmentList));
    localStorage.setItem(STORAGE_KEYS.activities, JSON.stringify(activityStack));
    localStorage.setItem(STORAGE_KEYS.maintenance, JSON.stringify(maintenanceQueue));
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(userAccounts));
    localStorage.setItem(STORAGE_KEYS.returnProofs, JSON.stringify(returnProofs));
    return true;
  } catch (error) {
    console.error("Could not save application data.", error);
    showToast("Browser storage is unavailable. Changes may not persist after closing this page.", true);
    return false;
  }
}

if (localStorage.getItem(STORAGE_KEYS.maintenance) === null) {
  maintenanceQueue = equipmentList.filter(record => record.status === "Under Maintenance").map(record => record.id);
}
maintenanceQueue = maintenanceQueue.filter(id => equipmentList.some(record => record.id === id && record.status === "Under Maintenance"));
saveData();

// 3. Login
const loginScreen = document.getElementById("loginScreen");
const registrationScreen = document.getElementById("registrationScreen");
const appShell = document.getElementById("appShell");
const userShell = document.getElementById("userShell");

function showLogin() {
  loginScreen.hidden = false;
  registrationScreen.hidden = true;
  appShell.hidden = true;
  userShell.hidden = true;
}

function requireAdmin() {
  if (currentUser?.role === "admin") return true;
  showToast("Access Denied. You do not have permission to perform this action.", true);
  return false;
}

function setSession(user) {
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
}

function clearSession() {
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  location.hash = "";
}

function createAdminSession() {
  setSession({ id: "admin", fullName: "Administrator", username: "admin", email: "", role: "admin", createdAt: "" });
  loginScreen.hidden = true;
  registrationScreen.hidden = true;
  userShell.hidden = true;
  appShell.hidden = false;
  renderAll();
  showToast("Login successful.");
  document.querySelector("[data-page='dashboard']").focus();
}

function createUserSession(account) {
  setSession({ id: account.id, fullName: account.fullName, username: account.username, email: account.email, role: "user", createdAt: account.createdAt });
  loginScreen.hidden = true;
  registrationScreen.hidden = true;
  appShell.hidden = true;
  userShell.hidden = false;
  renderUserDashboard();
  navigateUserTo("home", false);
  showToast("Login successful.");
}

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const error = document.getElementById("loginError");
  if (username === "admin" && password === "admin123") {
    error.hidden = true;
    createAdminSession();
    return;
  }
  const account = userAccounts.find(user => user.username.toLowerCase() === username.toLowerCase() && user.role === "user");
  if (account && await passwordMatches(password, account.passwordSalt, account.passwordHash)) {
    error.hidden = true;
    createUserSession(account);
    return;
  }
  error.hidden = false;
  document.getElementById("password").focus();
});

document.getElementById("showRegistrationButton").addEventListener("click", () => {
  loginScreen.hidden = true;
  registrationScreen.hidden = false;
  document.getElementById("registrationForm").reset();
  document.getElementById("registrationError").hidden = true;
  document.getElementById("registrationSuccess").hidden = true;
  document.querySelector("#registrationForm [name='fullName']").focus();
});
document.getElementById("backToLoginButton").addEventListener("click", showLogin);

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

async function hashPassword(password, saltHex) {
  if (!globalThis.crypto?.subtle) throw new Error("Secure password hashing is unavailable in this browser. Open this page from localhost or HTTPS.");
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256);
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

async function passwordMatches(password, salt, expectedHash) {
  try {
    const result = await hashPassword(password, salt);
    return result.hash === expectedHash;
  } catch (error) {
    console.error("Could not verify password.", error);
    return false;
  }
}

document.getElementById("registrationForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorMessage = document.getElementById("registrationError");
  const successMessage = document.getElementById("registrationSuccess");
  errorMessage.hidden = true;
  successMessage.hidden = true;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const fullName = values.fullName.trim();
  const username = values.username.trim();
  const email = values.email.trim().toLowerCase();
  if (!fullName || !username || !email) return setRegistrationError("Complete all required fields.");
  if (values.password.length < 8) return setRegistrationError("Password must be at least 8 characters.");
  if (values.password !== values.confirmPassword) return setRegistrationError("Passwords do not match.");
  if (username.toLowerCase() === "admin") return setRegistrationError("That username is reserved.");
  if (userAccounts.some(user => user.username.toLowerCase() === username.toLowerCase())) return setRegistrationError("That username is already registered.");
  if (userAccounts.some(user => user.email.toLowerCase() === email)) return setRegistrationError("That email address is already registered.");
  try {
    const credential = await hashPassword(values.password);
    userAccounts.push({ id: crypto.randomUUID(), fullName, username, email, passwordSalt: credential.salt, passwordHash: credential.hash, role: "user", createdAt: new Date().toISOString() });
    saveData();
    form.reset();
    successMessage.textContent = "Account created successfully. You can now log in.";
    successMessage.hidden = false;
    document.getElementById("username").value = username;
    document.getElementById("password").focus();
  } catch (error) {
    console.error("Could not create account.", error);
    setRegistrationError(error.message || "Could not create account. Please try again.");
  }
});

function setRegistrationError(message) {
  const error = document.getElementById("registrationError");
  error.textContent = message;
  error.hidden = false;
}

document.getElementById("exitButton").addEventListener("click", () => showToast("You can close this browser tab to exit."));
document.getElementById("logoutButton").addEventListener("click", () => {
  clearSession();
  showLogin();
  document.getElementById("loginForm").reset();
  document.getElementById("loginError").hidden = true;
  document.getElementById("username").focus();
});
document.getElementById("userLogoutButton").addEventListener("click", () => {
  clearSession();
  showLogin();
  document.getElementById("loginForm").reset();
  showToast("You have been logged out.");
});

// 4. Dashboard
function isEquipmentAvailable(record) {
  return record.status === "Available" && Number(record.quantity) > 0;
}

function renderUserEquipmentCard(record) {
  const available = isEquipmentAvailable(record);
  const category = record.category || "Uncategorized";
  const description = record.description || `${category} equipment for school use.`;
  return `<article class="user-equipment-card"><div class="user-card-top"><span class="user-category">${escapeHTML(category)}</span><span class="availability-pill ${available ? "is-available" : "is-unavailable"}">${available ? "Available" : "Unavailable"}</span></div><h3>${escapeHTML(record.name)}</h3><p class="user-equipment-description">${escapeHTML(description)}</p><div class="user-item-meta"><span>Quantity<strong>${escapeHTML(record.quantity)} units</strong></span><span>Status<strong>${escapeHTML(record.status)}</strong></span></div></article>`;
}

function getUserBorrowedEquipment() {
  if (!currentUser) return [];
  const normalizedUser = currentUser.fullName?.trim().toLowerCase() || currentUser.username?.trim().toLowerCase();
  return equipmentList.filter(record => {
    const assigned = (record.assignedTo || "").toLowerCase();
    const statusIsBorrowed = record.status === "In Use" || record.status === "Available";
    const matchesUser = !normalizedUser ? false : assigned.includes(normalizedUser) || assigned.includes("faculty") || assigned.includes("student");
    return statusIsBorrowed && matchesUser;
  });
}

function renderUserBorrowedEquipment() {
  const borrowed = getUserBorrowedEquipment();
  const host = document.getElementById("userBorrowedEquipment");
  if (!host) return;
  if (!borrowed.length) {
    host.innerHTML = `<div class="empty-state">No borrowed equipment found for your account.</div>`;
    return;
  }
  host.innerHTML = borrowed.map(record => `
    <article class="user-borrow-card">
      <h3>${escapeHTML(record.name)}</h3>
      <div class="user-borrow-meta">
        <div><span>Equipment ID</span><strong>${escapeHTML(record.id)}</strong></div>
        <div><span>Borrowed Date</span><strong>${escapeHTML(record.purchaseDate || "—")}</strong></div>
        <div><span>Expected Return</span><strong>${escapeHTML(getExpectedReturnDate(record.purchaseDate))}</strong></div>
        <div><span>Status</span><strong>${escapeHTML(record.status)}</strong></div>
      </div>
      <div class="user-borrow-actions">
        <button class="button button-primary return-proof-button" type="button" data-action="submit-return-proof" data-equipment-id="${escapeHTML(record.id)}">Submit Return Proof</button>
      </div>
    </article>
  `).join("");
}

function getExpectedReturnDate(purchaseDate) {
  if (!purchaseDate) return "Not set";
  const date = new Date(purchaseDate);
  date.setDate(date.getDate() + 3);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderUserReturnHistory() {
  const host = document.getElementById("userReturnHistory");
  if (!host) return;
  const entries = returnProofs.filter(entry => entry.borrowerId === currentUser?.id);
  if (!entries.length) {
    host.innerHTML = `<div class="empty-state">No return submissions yet.</div>`;
    return;
  }
  host.innerHTML = entries.map(entry => `
    <article class="user-proof-card">
      <h3>${escapeHTML(entry.equipmentName)} (${escapeHTML(entry.equipmentId)})</h3>
      <div class="user-proof-meta">
        <div><span>Returned</span><strong>${escapeHTML(entry.returnDate || "—")}</strong></div>
        <div><span>Submitted</span><strong>${escapeHTML(formatDateTime(entry.submittedAt))}</strong></div>
        <div><span>Status</span><strong><span class="status-chip ${proofStatusClass(entry.status)}">${escapeHTML(entry.status)}</span></strong></div>
        <div><span>Reason</span><strong>${escapeHTML(entry.rejectionReason || "—")}</strong></div>
      </div>
      <div class="user-proof-actions">
        <button class="button button-outline" type="button" data-action="view-return-proof" data-proof-id="${escapeHTML(entry.id)}">View Submission</button>
      </div>
    </article>
  `).join("");
}

function renderUserDashboard() {
  if (currentUser?.role !== "user") return;
  const available = equipmentList.filter(isEquipmentAvailable);
  const unavailable = equipmentList.filter(record => !isEquipmentAvailable(record));
  const sumQuantity = records => records.reduce((total, record) => total + Number(record.quantity || 0), 0);
  document.getElementById("userWelcomeName").textContent = currentUser.fullName.split(/\s+/)[0] || "there";
  document.getElementById("userAvailableCount").textContent = sumQuantity(available);
  document.getElementById("userUnavailableCount").textContent = sumQuantity(unavailable);
  document.getElementById("userHomeEquipment").innerHTML = equipmentList.length ? equipmentList.slice(0, 6).map(renderUserEquipmentCard).join("") : `<div class="empty-state">No equipment records found.</div>`;
  renderUserBorrowedEquipment();
  renderUserReturnHistory();
  renderUserCatalog();
  document.getElementById("userUnavailableGrid").innerHTML = unavailable.length ? unavailable.map(renderUserEquipmentCard).join("") : `<div class="empty-state">No unavailable equipment found.</div>`;
  document.getElementById("userProfile").innerHTML = `<div class="profile-avatar">${escapeHTML(currentUser.fullName.slice(0, 1).toUpperCase())}</div><dl class="profile-details"><div><dt>Full Name</dt><dd>${escapeHTML(currentUser.fullName)}</dd></div><div><dt>Username</dt><dd>${escapeHTML(currentUser.username)}</dd></div><div><dt>Email</dt><dd>${escapeHTML(currentUser.email)}</dd></div><div><dt>Account Type</dt><dd>Normal User</dd></div><div><dt>Account Created</dt><dd>${escapeHTML(new Date(currentUser.createdAt).toLocaleString())}</dd></div></dl>`;
}

function renderUserCatalog() {
  const keyword = document.getElementById("userSearchInput").value.trim().toLowerCase();
  const filter = document.querySelector("[data-user-filter].active")?.dataset.userFilter || "all";
  const matching = equipmentList.filter(record => {
    const available = isEquipmentAvailable(record);
    const matchesStatus = filter === "all" || (filter === "available" ? available : !available);
    const matchesKeyword = !keyword || `${record.name} ${record.category}`.toLowerCase().includes(keyword);
    return matchesStatus && matchesKeyword;
  });
  document.getElementById("userEquipmentFeedback").textContent = `${matching.length} equipment record(s) found.`;
  document.getElementById("userEquipmentGrid").innerHTML = matching.length ? matching.map(renderUserEquipmentCard).join("") : `<div class="empty-state">No matching equipment found.</div>`;
}

function navigateUserTo(page, updateHash = true) {
  if (currentUser?.role !== "user") return denyAdminAccess();
  const validPages = ["home", "available", "unavailable", "profile"];
  if (!validPages.includes(page)) return denyAdminAccess();
  document.querySelectorAll(".user-page").forEach(section => { section.hidden = section.id !== `user-page-${page}`; });
  document.querySelectorAll(".user-nav-item[data-user-page]").forEach(button => {
    const active = button.dataset.userPage === page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (updateHash) location.hash = ({ home: "user-dashboard", available: "available-equipment", unavailable: "unavailable-equipment", profile: "profile" })[page];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function denyAdminAccess() {
  if (currentUser?.role === "user") {
    userShell.hidden = false;
    appShell.hidden = true;
    loginScreen.hidden = true;
    registrationScreen.hidden = true;
    navigateUserTo("home");
  } else {
    showLogin();
  }
  showToast("Access Denied. You do not have permission to access this page.", true);
}

document.querySelectorAll("[data-user-page]").forEach(button => button.addEventListener("click", event => {
  event.preventDefault();
  navigateUserTo(button.dataset.userPage);
}));
document.addEventListener("click", event => {
  const submitButton = event.target.closest("[data-action='submit-return-proof']");
  if (submitButton) {
    openReturnProofForm(submitButton.dataset.equipmentId);
    return;
  }
  const viewProofButton = event.target.closest("[data-action='view-return-proof']");
  if (viewProofButton) {
    const proof = returnProofs.find(item => item.id === viewProofButton.dataset.proofId);
    if (proof) openReturnProofViewer(proof);
    return;
  }
  const adminViewButton = event.target.closest("[data-admin-action='view-proof']");
  if (adminViewButton) {
    const proof = returnProofs.find(item => item.id === adminViewButton.dataset.proofId);
    if (proof) openReturnProofViewer(proof);
    return;
  }
  const adminApproveButton = event.target.closest("[data-admin-action='approve-proof']");
  if (adminApproveButton) {
    const proof = returnProofs.find(item => item.id === adminApproveButton.dataset.proofId);
    if (proof) openApprovalConfirm(proof);
    return;
  }
  const adminRejectButton = event.target.closest("[data-admin-action='reject-proof']");
  if (adminRejectButton) {
    const proof = returnProofs.find(item => item.id === adminRejectButton.dataset.proofId);
    if (proof) openRejectReasonForm(proof);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    if (!requireAdmin()) return;
    const record = equipmentList.find(item => item.id === actionButton.dataset.id);
    if (!record) return showToast("Record not found.", true);
    if (actionButton.dataset.action === "view") showDetails(record);
    if (actionButton.dataset.action === "edit") showEdit(record);
    if (actionButton.dataset.action === "status") showStatusEditor(record);
    if (actionButton.dataset.action === "delete") showDeleteConfirmation(record);
  }
  if (event.target.closest("[data-cancel-form]")) navigateTo("equipment");
});
document.getElementById("userSearchInput").addEventListener("input", renderUserCatalog);
document.getElementById("userUnavailableSearch").addEventListener("input", event => {
  const keyword = event.currentTarget.value.trim().toLowerCase();
  const records = equipmentList.filter(record => !isEquipmentAvailable(record) && `${record.name} ${record.category}`.toLowerCase().includes(keyword));
  document.getElementById("userUnavailableGrid").innerHTML = records.length ? records.map(renderUserEquipmentCard).join("") : `<div class="empty-state">No matching equipment found.</div>`;
});
document.querySelectorAll("[data-user-filter]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-user-filter]").forEach(option => option.classList.toggle("active", option === button));
  renderUserCatalog();
}));

function handleLocationChange() {
  const route = location.hash.replace(/^#\/?/, "").toLowerCase();
  if (currentUser?.role === "user") {
    const routes = { "user-dashboard": "home", "available-equipment": "available", "unavailable-equipment": "unavailable", profile: "profile" };
    if (!routes[route]) return denyAdminAccess();
    return navigateUserTo(routes[route], false);
  }
  if (["admin", "admin-dashboard", "admin/equipment"].includes(route) && currentUser?.role !== "admin") return denyAdminAccess();
  if (currentUser?.role === "admin" && route.startsWith("user-")) return navigateTo("dashboard");
  if (route.startsWith("admin/") && currentUser?.role !== "admin") return denyAdminAccess();
  if (!currentUser && route) showLogin();
}

window.addEventListener("hashchange", handleLocationChange);

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (saved?.role === "admin" && saved.username === "admin" && saved.id === "admin") {
      currentUser = { id: "admin", fullName: "Administrator", username: "admin", email: "", role: "admin", createdAt: "" };
      loginScreen.hidden = true;
      appShell.hidden = false;
      renderAll();
      handleLocationChange();
      return;
    }
    if (saved?.role === "user") {
      const account = userAccounts.find(user => user.id === saved.id && user.role === "user");
      if (account) {
        currentUser = { id: account.id, fullName: account.fullName, username: account.username, email: account.email, role: "user", createdAt: account.createdAt };
        loginScreen.hidden = true;
        userShell.hidden = false;
        renderUserDashboard();
        const routes = { "available-equipment": "available", "unavailable-equipment": "unavailable", profile: "profile" };
        navigateUserTo(routes[location.hash.slice(1)] || "home", false);
        return;
      }
    }
  } catch (error) {
    console.error("Could not restore the local session.", error);
  }
  sessionStorage.removeItem(SESSION_KEY);
  showLogin();
}

function quantityForStatus(status) {
  return equipmentList.reduce((total, record) => total + (record.status === status ? Number(record.quantity) : 0), 0);
}

function renderDashboard() {
  const metrics = [
    ["TOTAL EQUIPMENT", equipmentList.reduce((total, record) => total + Number(record.quantity), 0), "units across all records", "#638bb0"],
    ["AVAILABLE", quantityForStatus("Available"), "units ready to use", "#4d9a73"],
    ["IN USE", quantityForStatus("In Use"), "units assigned", "#5687b7"],
    ["UNDER MAINTENANCE", quantityForStatus("Under Maintenance"), "units being serviced", "#d3a047"],
    ["LOST", quantityForStatus("Lost"), "units reported lost", "#c66d6d"]
  ];
  document.getElementById("dashboardMetrics").innerHTML = metrics.map(([label, value, detail, accent]) => `<article class="metric-card" style="--metric-accent:${accent}"><span class="metric-label">${label}</span><div class="metric-value">${value}</div><span class="metric-detail">${detail}</span></article>`).join("");
  const newestFirst = [...equipmentList].reverse().slice(0, 5);
  document.getElementById("dashboardTable").innerHTML = renderTable(newestFirst, false, "No equipment records found.");
}

// 5. Equipment CRUD
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function statusClass(status) {
  return `status-${String(status).toLowerCase().replaceAll(" ", "-")}`;
}

function renderTable(records, includeActions = true, emptyMessage = "No equipment records found.") {
  if (records.length === 0) return `<div class="empty-state">${escapeHTML(emptyMessage)}</div>`;
  const columns = ["ID", "Name", "Category", "Brand", "Serial Number", "Quantity", "Location", "Assigned To", "Status", "Condition"];
  if (includeActions) columns.push("Actions");
  const header = columns.map(column => `<th scope="col">${column}</th>`).join("");
  const rows = records.map(record => `<tr>
    <td class="id-cell">${escapeHTML(record.id)}</td>
    <td class="item-cell"><strong>${escapeHTML(record.name)}</strong><small>${escapeHTML(record.purchaseDate || "No purchase date")}</small></td>
    <td>${escapeHTML(record.category)}</td><td>${escapeHTML(record.brand)}</td><td>${escapeHTML(record.serialNumber)}</td>
    <td>${escapeHTML(record.quantity)}</td><td>${escapeHTML(record.location)}</td><td>${escapeHTML(record.assignedTo)}</td>
    <td><span class="status-badge ${statusClass(record.status)}">${escapeHTML(record.status)}</span></td>
    <td><span class="condition-label">${escapeHTML(record.condition)}</span></td>
    ${includeActions ? `<td><div class="action-buttons"><button class="table-action" data-action="view" data-id="${escapeHTML(record.id)}">View</button><button class="table-action" data-action="edit" data-id="${escapeHTML(record.id)}">Edit</button><button class="table-action" data-action="status" data-id="${escapeHTML(record.id)}">Status</button><button class="table-action danger" data-action="delete" data-id="${escapeHTML(record.id)}">Delete</button></div></td>` : ""}
  </tr>`).join("");
  return `<table class="data-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function equipmentFormMarkup(record = {}, editing = false) {
  const textField = (name, label, value = "", required = true, type = "text", extra = "") => `<label>${label}<input name="${name}" type="${type}" value="${escapeHTML(value)}" ${required ? "required" : ""} ${extra}></label>`;
  const selectField = (name, label, options, value) => `<label>${label}<select name="${name}" required>${options.map(option => `<option value="${escapeHTML(option)}" ${option === value ? "selected" : ""}>${escapeHTML(option)}</option>`).join("")}</select></label>`;
  return `<form class="equipment-form" data-equipment-form="${editing ? "edit" : "add"}" ${editing ? `data-edit-id="${escapeHTML(record.id)}"` : ""}>
    ${editing ? `<p class="form-section-title">Editing ${escapeHTML(record.id)} · ID cannot be changed</p>` : `<p class="form-section-title">Identification</p>`}
    ${editing ? `<div class="readonly-field"><label>Equipment ID<input value="${escapeHTML(record.id)}" readonly></label></div>` : textField("id", "Equipment ID", "", true, "text", "placeholder=\"e.g. EQ006\"")}
    ${textField("name", "Equipment name", record.name)}${textField("category", "Category", record.category)}${textField("brand", "Brand", record.brand)}${textField("serialNumber", "Serial number", record.serialNumber)}
    <p class="form-section-title">Purchase &amp; assignment</p>
    ${textField("quantity", "Quantity", record.quantity ?? "", true, "number", "min=\"1\" step=\"1\"")}${textField("purchaseDate", "Purchase date", record.purchaseDate, true, "date")}${textField("purchasePrice", "Purchase price", record.purchasePrice ?? "", true, "number", "min=\"0\" step=\"0.01\"")}
    ${textField("location", "Current location", record.location)}${textField("assignedTo", "Assigned to", record.assignedTo)}${selectField("status", "Status", STATUSES, record.status || "Available")}${selectField("condition", "Condition", CONDITIONS, record.condition || "Good")}
    <div class="form-actions"><button class="button button-quiet" type="reset">Clear form</button><button class="button button-outline" type="button" data-cancel-form>Cancel</button><button class="button button-primary" type="submit">${editing ? "Save changes" : "Save equipment"}</button></div>
  </form>`;
}

document.getElementById("addFormMount").innerHTML = equipmentFormMarkup();
document.addEventListener("submit", event => {
  const form = event.target.closest("[data-equipment-form]");
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity() || !requireAdmin()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const quantity = Number(values.quantity);
  const price = Number(values.purchasePrice);
  if (!Number.isInteger(quantity) || quantity <= 0) return showToast("Quantity must be a whole number greater than 0.", true);
  if (!Number.isFinite(price) || price < 0) return showToast("Purchase price cannot be negative.", true);
  if (!STATUSES.includes(values.status) || !CONDITIONS.includes(values.condition)) return showToast("Select a valid status and condition.", true);
  const editing = form.dataset.equipmentForm === "edit";
  if (!editing && equipmentList.some(record => record.id.toLowerCase() === values.id.trim().toLowerCase())) return showToast("Equipment ID must be unique.", true);
  const record = {
    id: editing ? form.dataset.editId : values.id.trim(), name: values.name.trim(), category: values.category.trim(), brand: values.brand.trim(),
    serialNumber: values.serialNumber.trim(), quantity, purchaseDate: values.purchaseDate, purchasePrice: price,
    location: values.location.trim(), assignedTo: values.assignedTo.trim(), status: values.status, condition: values.condition
  };
  if (editing) {
    const index = equipmentList.findIndex(item => item.id === form.dataset.editId);
    if (index < 0) return showToast("That equipment record no longer exists.", true);
    equipmentList[index] = record;
    addActivity(`Updated ${record.name} ${record.id}`);
    syncMaintenanceStatus(record);
    closeModal();
    showToast("Equipment updated successfully.");
  } else {
    equipmentList.push(record);
    addActivity(`Added ${record.name} ${record.id}`);
    syncMaintenanceStatus(record);
    form.reset();
    showToast("Equipment added successfully.");
  }
  saveData();
  renderAll();
  if (!editing) navigateTo("equipment");
});

// 6. Search
function linearSearch(keyword, records = equipmentList) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const matches = [];
  if (!normalizedKeyword) return matches;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const searchableValues = [record.id, record.name, record.category, record.serialNumber, record.location, record.status];
    for (let fieldIndex = 0; fieldIndex < searchableValues.length; fieldIndex += 1) {
      if (String(searchableValues[fieldIndex]).toLowerCase().includes(normalizedKeyword)) {
        matches.push(record);
        break;
      }
    }
  }
  return matches;
}

document.getElementById("searchForm").addEventListener("submit", event => {
  event.preventDefault();
  const keyword = document.getElementById("searchInput").value;
  if (!keyword.trim()) {
    document.getElementById("searchFeedback").textContent = "Enter a keyword to search all equipment records.";
    document.getElementById("searchResults").innerHTML = "";
    return;
  }
  const matches = linearSearch(keyword);
  document.getElementById("searchFeedback").textContent = `Search Algorithm: Linear Search · ${matches.length} equipment record(s) found.`;
  document.getElementById("searchResults").innerHTML = renderTable(matches, true, "No matching equipment found.");
});
document.getElementById("clearSearch").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  document.getElementById("searchFeedback").textContent = "Enter a keyword to search all equipment records.";
  document.getElementById("searchResults").innerHTML = "";
});

// 7. Sorting
function bubbleSort(records, field, direction = "asc") {
  const sorted = records.map(record => ({ ...record }));
  const multiplier = direction === "desc" ? -1 : 1;
  for (let end = sorted.length - 1; end > 0; end -= 1) {
    let swapped = false;
    for (let index = 0; index < end; index += 1) {
      let comparison;
      const left = sorted[index][field];
      const right = sorted[index + 1][field];
      if (typeof left === "number" && typeof right === "number") comparison = left - right;
      else comparison = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
      if (comparison * multiplier > 0) {
        [sorted[index], sorted[index + 1]] = [sorted[index + 1], sorted[index]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return sorted;
}

document.getElementById("sortForm").addEventListener("submit", event => {
  event.preventDefault();
  const field = document.getElementById("sortField").value;
  const direction = new FormData(event.currentTarget).get("sortDirection");
  const sorted = bubbleSort(equipmentList, field, direction);
  document.getElementById("sortFeedback").textContent = `Sorted using Bubble Sort · ${fieldLabel(field)} · ${direction === "asc" ? "Ascending" : "Descending"}.`;
  document.getElementById("sortResults").innerHTML = renderTable(sorted, true);
});

function fieldLabel(field) {
  return ({ id: "Equipment ID", name: "Equipment name", category: "Category", quantity: "Quantity", status: "Status", location: "Location" })[field] || field;
}

// 8. Stack
function pushActivity(message) {
  activityStack.push({ message, timestamp: new Date().toISOString() });
  if (activityStack.length > 200) activityStack.shift();
}
function popActivity() { return activityStack.pop() || null; }
function peekActivity() { return activityStack.length ? activityStack[activityStack.length - 1] : null; }
function addActivity(message) { pushActivity(message); }

// 9. Queue
function enqueueMaintenance(id) {
  if (!maintenanceQueue.includes(id)) maintenanceQueue.push(id);
}
function dequeueMaintenance() { return maintenanceQueue.shift() || null; }
function peekMaintenance() { return maintenanceQueue.length ? maintenanceQueue[0] : null; }

function syncMaintenanceStatus(record) {
  maintenanceQueue = maintenanceQueue.filter(id => id !== record.id);
  if (record.status === "Under Maintenance") enqueueMaintenance(record.id);
}

// 10. Binary Search Tree
class BSTNode {
  constructor(record) {
    this.id = record.id;
    this.record = record;
    this.left = null;
    this.right = null;
  }
}

class BinarySearchTree {
  constructor() { this.root = null; }
  insert(record) {
    const newNode = new BSTNode(record);
    if (!this.root) { this.root = newNode; return; }
    let current = this.root;
    while (true) {
      if (record.id.localeCompare(current.id, undefined, { numeric: true }) < 0) {
        if (!current.left) { current.left = newNode; return; }
        current = current.left;
      } else if (record.id.localeCompare(current.id, undefined, { numeric: true }) > 0) {
        if (!current.right) { current.right = newNode; return; }
        current = current.right;
      } else return;
    }
  }
  search(id) {
    let current = this.root;
    while (current) {
      const comparison = id.localeCompare(current.id, undefined, { numeric: true, sensitivity: "base" });
      if (comparison === 0) return current.record;
      current = comparison < 0 ? current.left : current.right;
    }
    return null;
  }
  inOrderTraversal() {
    const ids = [];
    const visit = node => {
      if (!node) return;
      visit(node.left);
      ids.push(node.id);
      visit(node.right);
    };
    visit(this.root);
    return ids;
  }
  branchSummary() {
    if (!this.root) return "";
    const parts = [];
    const visit = (node, depth) => {
      if (!node) return;
      if (node.left) parts.push(`${"  ".repeat(depth)}← ${node.left.id} (left of ${node.id})`);
      if (node.right) parts.push(`${"  ".repeat(depth)}→ ${node.right.id} (right of ${node.id})`);
      visit(node.left, depth + 1);
      visit(node.right, depth + 1);
    };
    visit(this.root, 0);
    return parts.join("<br>");
  }
}

function buildBST() {
  const tree = new BinarySearchTree();
  for (const record of equipmentList) tree.insert(record);
  return tree;
}

function binarySearchById(id) {
  const sortedById = bubbleSort(equipmentList, "id", "asc");
  let low = 0;
  let high = sortedById.length - 1;
  const target = id.trim().toLowerCase();
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const comparison = sortedById[middle].id.toLowerCase().localeCompare(target, undefined, { numeric: true });
    if (comparison === 0) return sortedById[middle];
    if (comparison < 0) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

document.getElementById("bstSearchForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = document.getElementById("bstSearchInput").value.trim();
  const found = buildBST().search(id);
  const binaryFound = binarySearchById(id);
  document.getElementById("bstSearchResult").textContent = found ? `BST Search Result: ${found.id} · ${found.name}` : `BST Search Result: no equipment found for ${id}.`;
  document.getElementById("binarySearchResult").textContent = binaryFound ? `Binary Search Result: ${binaryFound.id} · ${binaryFound.name}` : `Binary Search Result: no equipment found for ${id}.`;
});

function renderBST() {
  const tree = buildBST();
  document.getElementById("bstRoot").textContent = tree.root ? `${tree.root.id} · ${tree.root.record.name}` : "Empty tree";
  document.getElementById("bstBranches").innerHTML = tree.branchSummary() || "Insert records to see left and right branches.";
  document.getElementById("bstTraversal").textContent = tree.inOrderTraversal().join(" → ") || "No equipment IDs";
}

document.getElementById("page-dsa").addEventListener("click", event => {
  const target = event.target.closest("[data-page='dsa']");
  if (target) renderBST();
});

// 11. Reports
function renderReports() {
  const statusCards = ["Total equipment", ...STATUSES];
  const statusValues = [equipmentList.reduce((total, record) => total + Number(record.quantity), 0), ...STATUSES.map(quantityForStatus)];
  const conditions = CONDITIONS.map(condition => ({ condition, quantity: equipmentList.reduce((total, record) => total + (record.condition === condition ? Number(record.quantity) : 0), 0) }));
  const statusMarkup = statusCards.map((label, index) => `<article class="report-card"><h3>${escapeHTML(label)}</h3><strong>${statusValues[index]}</strong><small>units</small></article>`).join("");
  const conditionMarkup = conditions.map(item => `<article class="report-card"><h3>${escapeHTML(item.condition)}</h3><strong>${item.quantity}</strong><small>units by condition</small></article>`).join("");
  document.getElementById("reportMetrics").innerHTML = statusMarkup + conditionMarkup;
  document.getElementById("reportTable").innerHTML = renderTable(equipmentList, false);
}
document.getElementById("printReportButton").addEventListener("click", () => { if (requireAdmin()) window.print(); });

// 12. UI functions
const pageNames = { dashboard: "Dashboard", equipment: "Equipment", add: "Add equipment", search: "Search", sort: "Sort equipment", maintenance: "Maintenance queue", history: "Activity history", reports: "Reports", dsa: "DSA demonstration" };

function navigateTo(page) {
  if (!requireAdmin()) return;
  if (!pageNames[page]) return showToast("Page not found.", true);
  document.querySelectorAll(".page-section").forEach(section => { section.hidden = section.id !== `page-${page}`; });
  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.getElementById("currentPageName").textContent = pageNames[page];
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("menuButton").setAttribute("aria-expanded", "false");
  if (page === "dsa") renderBST();
  if (page === "maintenance") renderQueue();
  if (page === "history") renderHistory();
  if (page === "reports") renderReports();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.page)));
document.querySelectorAll("[data-page-link]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); navigateTo(link.dataset.pageLink); }));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.go)));

document.getElementById("menuButton").addEventListener("click", event => {
  const open = document.getElementById("sidebar").classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", event => {
  const sidebar = document.getElementById("sidebar");
  if (sidebar.classList.contains("open") && !sidebar.contains(event.target) && !event.target.closest("#menuButton")) {
    sidebar.classList.remove("open");
    document.getElementById("menuButton").setAttribute("aria-expanded", "false");
  }
});

function renderAll() {
  renderDashboard();
  renderEquipment();
  renderQueue();
  renderHistory();
  renderReports();
  renderBST();
}

function renderEquipment(filter = "") {
  const records = filter ? linearSearch(filter) : equipmentList;
  document.getElementById("equipmentTable").innerHTML = renderTable(records, true);
  document.getElementById("equipmentCount").textContent = `${records.length} equipment record(s) · distinct records`;
}

document.getElementById("tableFilter").addEventListener("input", event => renderEquipment(event.currentTarget.value.trim()));

document.addEventListener("click", event => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    if (!requireAdmin()) return;
    const record = equipmentList.find(item => item.id === actionButton.dataset.id);
    if (!record) return showToast("Record not found.", true);
    if (actionButton.dataset.action === "view") showDetails(record);
    if (actionButton.dataset.action === "edit") showEdit(record);
    if (actionButton.dataset.action === "status") showStatusEditor(record);
    if (actionButton.dataset.action === "delete") showDeleteConfirmation(record);
  }
  if (event.target.closest("[data-cancel-form]")) navigateTo("equipment");
});

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function openReturnProofForm(equipmentId) {
  if (!currentUser || currentUser.role !== "user") return showToast("Only normal users can submit return proof.", true);
  const record = equipmentList.find(item => item.id === equipmentId);
  if (!record) return showToast("Equipment not found.", true);
  const existing = returnProofs.find(item => item.equipmentId === equipmentId && item.borrowerId === currentUser.id && ["Pending Review", "Approved"].includes(item.status));
  if (existing) {
    showToast(`Return proof already submitted. Status: ${existing.status}`, true);
    return;
  }
  const now = new Date();
  const content = `
    <form id="returnProofForm" class="modal-form" enctype="multipart/form-data">
      <input type="hidden" name="equipmentId" value="${escapeHTML(record.id)}">
      <input type="hidden" name="equipmentName" value="${escapeHTML(record.name)}">
      <label>Equipment<input value="${escapeHTML(record.name)}" readonly></label>
      <label>Equipment ID<input value="${escapeHTML(record.id)}" readonly></label>
      <label>Borrower<input value="${escapeHTML(currentUser.fullName)}" readonly></label>
      <label>Username<input value="${escapeHTML(currentUser.username)}" readonly></label>
      <label>Return Date<input name="returnDate" value="${escapeHTML(now.toISOString().slice(0, 10))}" readonly></label>
      <label>Return Time<input name="returnTime" value="${escapeHTML(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}" readonly></label>
      <label>Photo Proof<input id="returnProofFile" name="photo" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required></label>
      <div id="returnProofFileError" class="file-error" hidden></div>
      <div id="returnProofPreview" class="return-photo-preview" hidden><img id="returnProofImage" src="" alt="Return proof preview"><button class="button button-quiet" type="button" id="removeReturnProofImage">Remove</button></div>
      <label>Additional Note<textarea name="note" rows="3" placeholder="Optional note"></textarea></label>
      <div class="file-error">Maximum file size: 20 MB</div>
    </form>
  `;
  openModal({ eyebrow: "RETURN PROOF", title: "Submit Return Proof", content, actions: [{ action: "close", label: "Cancel", className: "button-quiet" }, { action: "submit-return-proof", label: "Submit Return Proof", className: "button-primary" }] });
  const fileInput = document.getElementById("returnProofFile");
  const preview = document.getElementById("returnProofPreview");
  const image = document.getElementById("returnProofImage");
  fileInput.addEventListener("change", event => {
    const selected = event.target.files && event.target.files[0];
    const error = document.getElementById("returnProofFileError");
    if (!selected) {
      preview.hidden = true;
      error.hidden = true;
      return;
    }
    if (selected.size > MAX_RETURN_PHOTO_SIZE) {
      error.textContent = "File exceeds the 20 MB maximum size.";
      error.hidden = false;
      preview.hidden = true;
      fileInput.value = "";
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(selected.type)) {
      error.textContent = "Only JPG, JPEG, PNG, and WEBP images are allowed.";
      error.hidden = false;
      preview.hidden = true;
      fileInput.value = "";
      return;
    }
    error.hidden = true;
    const reader = new FileReader();
    reader.onload = () => {
      image.src = reader.result;
      preview.hidden = false;
    };
    reader.readAsDataURL(selected);
  });
  document.getElementById("removeReturnProofImage").addEventListener("click", () => {
    fileInput.value = "";
    preview.hidden = true;
    document.getElementById("returnProofFileError").hidden = true;
  });
}

function saveReturnProofFromModal() {
  const form = document.getElementById("returnProofForm");
  if (!form) return;
  const fileInput = form.querySelector("input[name='photo']");
  const equipmentId = form.querySelector("input[name='equipmentId']")?.value || "";
  const equipmentName = form.querySelector("input[name='equipmentName']")?.value || "";
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;
  if (!file) {
    showToast("Please upload a photo as proof of return.", true);
    return;
  }
  const error = document.getElementById("returnProofFileError");
  if (file.size > MAX_RETURN_PHOTO_SIZE) {
    error.textContent = "File exceeds the 20 MB maximum size.";
    error.hidden = false;
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    error.textContent = "Only JPG, JPEG, PNG, and WEBP images are allowed.";
    error.hidden = false;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const proof = {
      id: `RP-${String(returnProofs.length + 1).padStart(3, "0")}`,
      equipmentId: equipmentId,
      equipmentName: equipmentName,
      borrowerId: currentUser.id,
      borrowerName: currentUser.fullName,
      borrowerUsername: currentUser.username,
      photoUrl: reader.result,
      note: form.querySelector("textarea[name='note']")?.value || "",
      returnDate: form.querySelector("input[name='returnDate']")?.value || new Date().toISOString().slice(0, 10),
      returnTime: form.querySelector("input[name='returnTime']")?.value || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      submittedAt: new Date().toISOString(),
      status: "Pending Review",
      rejectionReason: "",
      receiverId: "",
      receiverName: "",
      receiverUsername: "",
      reviewedAt: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const equipmentRecord = equipmentList.find(item => item.id === proof.equipmentId);
    proof.equipmentId = equipmentRecord ? equipmentRecord.id : proof.equipmentId;
    proof.equipmentName = equipmentRecord ? equipmentRecord.name : proof.equipmentName;
    returnProofs.push(proof);
    saveData();
    renderUserDashboard();
    closeModal();
    showToast("Return proof submitted successfully.");
  };
  reader.readAsDataURL(file);
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function proofStatusClass(status) {
  return String(status || "Pending Review").toLowerCase().replace(/\s+/g, "-");
}

function renderAdminReturnProofs() {
  const host = document.getElementById("adminReturnProofsPanel");
  if (!host) return;
  if (currentUser?.role !== "admin") {
    host.innerHTML = `<div class="empty-state">Admin access required.</div>`;
    return;
  }
  const filter = (document.getElementById("adminReturnProofFilter") || {}).value || "All";
  const query = (document.getElementById("adminReturnProofSearch") || {}).value || "";
  const filtered = returnProofs.filter(entry => {
    const matchesFilter = filter === "All" || entry.status === filter;
    const haystack = `${entry.equipmentName} ${entry.equipmentId} ${entry.borrowerName} ${entry.borrowerUsername}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  }).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  host.innerHTML = `
    <div class="filter-row">
      <input id="adminReturnProofSearch" class="admin-search" type="search" placeholder="Search equipment, ID, borrower, username" value="${escapeHTML(query)}">
      <button class="filter-pill ${filter === "All" ? "active" : ""}" type="button" data-return-filter="All">All</button>
      <button class="filter-pill ${filter === "Pending Review" ? "active" : ""}" type="button" data-return-filter="Pending Review">Pending Review</button>
      <button class="filter-pill ${filter === "Approved" ? "active" : ""}" type="button" data-return-filter="Approved">Approved</button>
      <button class="filter-pill ${filter === "Rejected" ? "active" : ""}" type="button" data-return-filter="Rejected">Rejected</button>
    </div>
    ${filtered.length ? filtered.map(proof => `
      <article class="admin-return-card">
        <div class="admin-return-head">
          <h3>RETURN PROOF ${escapeHTML(proof.id)}</h3>
          <span class="status-chip ${proofStatusClass(proof.status)}">${escapeHTML(proof.status)}</span>
        </div>
        <div class="admin-return-grid">
          <div><span>Equipment</span><strong>${escapeHTML(proof.equipmentName)}</strong></div>
          <div><span>Equipment ID</span><strong>${escapeHTML(proof.equipmentId)}</strong></div>
          <div><span>Borrower</span><strong>${escapeHTML(proof.borrowerName)}</strong></div>
          <div><span>Username</span><strong>${escapeHTML(proof.borrowerUsername)}</strong></div>
          <div><span>Return Date</span><strong>${escapeHTML(proof.returnDate)}</strong></div>
          <div><span>Return Time</span><strong>${escapeHTML(proof.returnTime)}</strong></div>
          <div><span>Submitted</span><strong>${escapeHTML(formatDateTime(proof.submittedAt))}</strong></div>
          <div><span>Status</span><strong>${escapeHTML(proof.status)}</strong></div>
        </div>
        <div class="admin-return-action-row">
          <button class="button button-outline" type="button" data-admin-action="view-proof" data-proof-id="${escapeHTML(proof.id)}">View Photo</button>
          <button class="button button-primary" type="button" data-admin-action="approve-proof" data-proof-id="${escapeHTML(proof.id)}">Approve</button>
          <button class="button button-quiet" type="button" data-admin-action="reject-proof" data-proof-id="${escapeHTML(proof.id)}">Reject</button>
        </div>
      </article>
    `).join("") : `<div class="empty-state">No return proofs found.</div>`}
  `;
  const searchInput = document.getElementById("adminReturnProofSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => renderAdminReturnProofs());
  }
  document.querySelectorAll("[data-return-filter]").forEach(btn => btn.addEventListener("click", () => {
    document.getElementById("adminReturnProofFilter")?.remove();
    const temp = document.createElement("input");
    temp.id = "adminReturnProofFilter";
    temp.type = "hidden";
    temp.value = btn.dataset.returnFilter;
    document.body.appendChild(temp);
    renderAdminReturnProofs();
  }));
}

function openReturnProofViewer(proof) {
  const content = `
    <div class="return-photo-preview">
      <img src="${proof.photoUrl}" alt="Return proof for ${escapeHTML(proof.equipmentName)}">
      <div class="admin-return-grid">
        <div><span>Equipment Name</span><strong>${escapeHTML(proof.equipmentName)}</strong></div>
        <div><span>Equipment ID</span><strong>${escapeHTML(proof.equipmentId)}</strong></div>
        <div><span>Borrower</span><strong>${escapeHTML(proof.borrowerName)}</strong></div>
        <div><span>Return Date</span><strong>${escapeHTML(proof.returnDate)}</strong></div>
        <div><span>Return Time</span><strong>${escapeHTML(proof.returnTime)}</strong></div>
        <div><span>Submitted</span><strong>${escapeHTML(formatDateTime(proof.submittedAt))}</strong></div>
        <div><span>Status</span><strong>${escapeHTML(proof.status)}</strong></div>
      </div>
    </div>
  `;
  openModal({ eyebrow: "RETURN PROOF", title: `Photo Review · ${proof.id}`, content, actions: [{ action: "close", label: "Close", className: "button-outline" }] });
}

function openApprovalConfirm(proof) {
  openModal({
    eyebrow: "APPROVE RETURN",
    title: "Approve Return?",
    content: `<p class="confirm-copy">Equipment: <strong>${escapeHTML(proof.equipmentName)}</strong><br>Borrower: <strong>${escapeHTML(proof.borrowerName)}</strong><br><br>Are you sure this equipment has been returned?</p>`,
    actions: [{ action: "close", label: "Cancel", className: "button-quiet" }, { action: "confirm-approve-proof", label: "Confirm Approval", className: "button-primary", data: { proofId: proof.id } }]
  });
  const approveButton = document.querySelector('[data-modal-action="confirm-approve-proof"]');
  if (approveButton) approveButton.dataset.proofId = proof.id;
}

function openRejectReasonForm(proof) {
  openModal({
    eyebrow: "REJECT RETURN",
    title: "Reject Return Proof",
    content: `<form id="rejectReasonForm" class="modal-form"><label>Reason<textarea name="rejectionReason" rows="4" required placeholder="Please describe why this proof was rejected."></textarea></label></form>`,
    actions: [{ action: "close", label: "Cancel", className: "button-quiet" }, { action: "confirm-reject-proof", label: "Reject Proof", className: "button-primary", data: { proofId: proof.id } }]
  });
  const rejectButton = document.querySelector('[data-modal-action="confirm-reject-proof"]');
  if (rejectButton) rejectButton.dataset.proofId = proof.id;
}

function approveReturnProof(proofId) {
  const proof = returnProofs.find(item => item.id === proofId);
  if (!proof) return;
  const admin = currentUser;
  proof.status = "Approved";
  proof.reviewedBy = admin.fullName;
  proof.receiverId = admin.id;
  proof.receiverName = admin.fullName;
  proof.receiverUsername = admin.username;
  proof.reviewedAt = new Date().toISOString();
  proof.updatedAt = proof.reviewedAt;
  const equipmentRecord = equipmentList.find(item => item.id === proof.equipmentId);
  if (equipmentRecord) {
    equipmentRecord.status = "Available";
    equipmentRecord.assignedTo = "School Inventory";
  }
  saveData();
  renderAll();
  renderUserDashboard();
  renderAdminReturnProofs();
  closeModal();
  showToast("Return proof approved.");
}

function rejectReturnProof(proofId, reason) {
  const proof = returnProofs.find(item => item.id === proofId);
  if (!proof) return;
  proof.status = "Rejected";
  proof.rejectionReason = reason;
  proof.reviewedBy = currentUser.fullName;
  proof.receiverId = currentUser.id;
  proof.receiverName = currentUser.fullName;
  proof.receiverUsername = currentUser.username;
  proof.reviewedAt = new Date().toISOString();
  proof.updatedAt = proof.reviewedAt;
  saveData();
  renderAll();
  renderUserDashboard();
  renderAdminReturnProofs();
  closeModal();
  showToast("Return proof rejected.");
}

function handleModalAction(action, button) {
  if (action === "submit-return-proof") {
    saveReturnProofFromModal();
    return;
  }
  if (action === "confirm-approve-proof") {
    approveReturnProof(button.dataset.proofId);
    return;
  }
  if (action === "confirm-reject-proof") {
    const form = document.getElementById("rejectReasonForm");
    const reason = form ? form.querySelector("textarea[name='rejectionReason']")?.value?.trim() : "";
    if (!reason) return showToast("Please provide a rejection reason.", true);
    rejectReturnProof(button.dataset.proofId, reason);
    return;
  }
}

function renderAdminDashboardSection() {
  if (currentUser?.role === "admin") renderAdminReturnProofs();
}

function renderAll() {
  renderDashboard();
  renderEquipment();
  renderQueue();
  renderHistory();
  renderReports();
  renderBST();
  renderAdminDashboardSection();
}

function openModal({ eyebrow = "EQUIPMENT", title, content, actions = [] }) {
  lastFocusedElement = document.activeElement;
  document.getElementById("modalEyebrow").textContent = eyebrow;
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalContent").innerHTML = content;
  document.getElementById("modalActions").innerHTML = actions.map(action => `<button class="button ${action.className}" type="button" data-modal-action="${action.action}">${action.label}</button>`).join("");
  const backdrop = document.getElementById("modalBackdrop");
  backdrop.hidden = false;
  const focusTarget = backdrop.querySelector("input:not([readonly]), select, button");
  if (focusTarget) focusTarget.focus();
}

function closeModal() {
  document.getElementById("modalBackdrop").hidden = true;
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
}

document.getElementById("closeModalButton").addEventListener("click", closeModal);
document.getElementById("modalBackdrop").addEventListener("click", event => { if (event.target.id === "modalBackdrop") closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !document.getElementById("modalBackdrop").hidden) closeModal(); });

function showDetails(record) {
  const fields = [["Equipment ID", record.id], ["Equipment name", record.name], ["Category", record.category], ["Brand", record.brand], ["Serial number", record.serialNumber], ["Quantity", record.quantity], ["Purchase date", record.purchaseDate], ["Purchase price", formatCurrency(record.purchasePrice)], ["Current location", record.location], ["Assigned to", record.assignedTo], ["Status", record.status], ["Condition", record.condition]];
  openModal({ title: record.name, content: `<div id="modalDescription" class="detail-grid">${fields.map(([label, value]) => `<div class="detail-field"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>`, actions: [{ action: "close", label: "Close", className: "button-outline" }] });
}

function showEdit(record) {
  if (!requireAdmin()) return;
  openModal({ title: "Edit equipment", content: equipmentFormMarkup(record, true), actions: [] });
  const form = document.querySelector("#modalContent [data-equipment-form]");
  if (!form) return showToast("Form not found.", true);
  form.classList.add("modal-form");
  form.querySelectorAll(".form-section-title").forEach(title => { title.style.gridColumn = "1 / -1"; });
  form.querySelectorAll(".form-actions").forEach(actions => { actions.remove(); });
  document.getElementById("modalActions").innerHTML = `<button class="button button-quiet" type="button" data-modal-action="close">Cancel</button><button class="button button-primary" type="submit" form="${form.id = "editEquipmentForm"}">Save changes</button>`;
}

function showStatusEditor(record) {
  if (!requireAdmin()) return;
  const statusOptions = STATUSES.map(status => `<option ${record.status === status ? "selected" : ""}>${status}</option>`).join("");
  const conditionOptions = CONDITIONS.map(condition => `<option ${record.condition === condition ? "selected" : ""}>${condition}</option>`).join("");
  openModal({ title: `Update status · ${record.id}`, content: `<form id="statusForm" class="modal-form" data-status-id="${escapeHTML(record.id)}"><label>Status<select name="status">${statusOptions}</select></label><label>Condition<select name="condition">${conditionOptions}</select></label></form>`, actions: [{ action: "close", label: "Cancel", className: "button-quiet" }, { action: "save-status", label: "Save status", className: "button-primary" }] });
}

function showDeleteConfirmation(record) {
  if (!requireAdmin()) return;
  openModal({ eyebrow: "CONFIRM DELETE", title: "Delete equipment?", content: `<p id="modalDescription" class="confirm-copy">Are you sure you want to delete this equipment? <strong>${escapeHTML(record.name)} (${escapeHTML(record.id)})</strong> will be removed from the register.</p>`, actions: [{ action: "close", label: "Cancel", className: "button-quiet" }, { action: "delete-record", label: "Delete", className: "button-primary" }] });
  document.querySelector('[data-modal-action="delete-record"]').dataset.id = record.id;
}

document.getElementById("modalActions").addEventListener("click", event => {
  const button = event.target.closest("[data-modal-action]");
  if (!button) return;
  const action = button.dataset.modalAction;
  if (["delete-record", "save-status"].includes(action) && !requireAdmin()) return closeModal();
  if (["submit-return-proof", "confirm-approve-proof", "confirm-reject-proof"].includes(action)) {
    handleModalAction(action, button);
    return;
  }
  if (action === "close") closeModal();
  if (action === "delete-record") {
    const record = equipmentList.find(item => item.id === button.dataset.id);
    if (record) {
      equipmentList = equipmentList.filter(item => item.id !== record.id);
      maintenanceQueue = maintenanceQueue.filter(id => id !== record.id);
      addActivity(`Deleted ${record.name} ${record.id}`);
      saveData();
      renderAll();
      showToast("Equipment deleted successfully.");
    }
    closeModal();
  }
  if (action === "save-status") {
    const form = document.getElementById("statusForm");
    const record = equipmentList.find(item => item.id === form.dataset.statusId);
    if (!record) return closeModal();
    const values = new FormData(form);
    record.status = values.get("status");
    record.condition = values.get("condition");
    syncMaintenanceStatus(record);
    addActivity(`Updated status for ${record.name} ${record.id}`);
    saveData();
    renderAll();
    closeModal();
    showToast("Equipment status updated successfully.");
  }
});

function formatCurrency(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { style: "currency", currency: "PHP", maximumFractionDigits: 2 }) : "—";
}

// 13. Validation
document.addEventListener("click", event => {
  const modalAction = event.target.closest("[data-modal-action='close']");
  if (modalAction) closeModal();
});

// 14. Event listeners: queue and history controls
function renderQueue() {
  const select = document.getElementById("queueEquipmentSelect");
  const currentValue = select.value;
  const eligible = equipmentList.filter(record => record.status !== "Under Maintenance" && !maintenanceQueue.includes(record.id));
  select.innerHTML = eligible.length ? eligible.map(record => `<option value="${escapeHTML(record.id)}">${escapeHTML(record.id)} · ${escapeHTML(record.name)}</option>`).join("") : `<option value="">No eligible equipment</option>`;
  if (eligible.some(record => record.id === currentValue)) select.value = currentValue;
  document.getElementById("queueSize").textContent = `${maintenanceQueue.length} request${maintenanceQueue.length === 1 ? "" : "s"}`;
  const nextId = peekMaintenance();
  const next = equipmentList.find(record => record.id === nextId);
  document.getElementById("queuePeek").innerHTML = next ? `Next request (peek): <strong>${escapeHTML(next.id)} · ${escapeHTML(next.name)}</strong>` : "Next request (peek): queue is empty.";
  document.getElementById("queueList").innerHTML = maintenanceQueue.length ? maintenanceQueue.map((id, index) => {
    const record = equipmentList.find(item => item.id === id);
    return record ? `<article class="queue-row"><span class="queue-position">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHTML(record.id)} · ${escapeHTML(record.name)}</strong><small>${escapeHTML(record.category)} · ${escapeHTML(record.condition)} condition</small></span><span class="status-badge status-under-maintenance">${escapeHTML(record.status)}</span></article>` : "";
  }).join("") : `<div class="empty-state">The maintenance queue is empty.</div>`;
}

document.getElementById("enqueueButton").addEventListener("click", () => {
  if (!requireAdmin()) return;
  const id = document.getElementById("queueEquipmentSelect").value;
  const record = equipmentList.find(item => item.id === id);
  if (!record) return showToast("There is no equipment available to add.", true);
  enqueueMaintenance(id);
  if (record.status !== "Under Maintenance") record.status = "Under Maintenance";
  record.condition = record.condition || "Good";
  addActivity(`Added ${record.id} to maintenance queue`);
  saveData();
  renderAll();
  showToast("Maintenance request added to the queue.");
});

document.getElementById("processQueueButton").addEventListener("click", () => {
  if (!requireAdmin()) return;
  const id = dequeueMaintenance();
  if (!id) return showToast("The maintenance queue is empty.", true);
  const record = equipmentList.find(item => item.id === id);
  if (record && record.status === "Under Maintenance") record.status = "Available";
  addActivity(`Processed maintenance request ${id}`);
  saveData();
  renderAll();
  showToast("Maintenance request processed.");
});

document.getElementById("clearQueueButton").addEventListener("click", () => {
  if (!requireAdmin()) return;
  maintenanceQueue = [];
  saveData();
  renderQueue();
  showToast("Maintenance queue cleared.");
});

function renderHistory() {
  const newest = peekActivity();
  document.getElementById("historyPeek").innerHTML = newest ? `Peek · <strong>${escapeHTML(newest.message)}</strong>` : "Peek · activity stack is empty.";
  document.getElementById("historyList").innerHTML = activityStack.length ? activityStack.slice().reverse().map((activity, index) => `<article class="history-row"><span class="history-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHTML(activity.message)}</strong><small>${new Date(activity.timestamp).toLocaleString()}</small></span><span class="condition-label">Most recent</span></article>`).join("") : `<div class="empty-state">No activity history yet.</div>`;
}

document.getElementById("popHistoryButton").addEventListener("click", () => {
  if (!requireAdmin()) return;
  const activity = popActivity();
  if (!activity) return showToast("The activity stack is empty.", true);
  saveData();
  renderHistory();
  showToast("Latest activity removed from history.");
});
document.getElementById("clearHistoryButton").addEventListener("click", () => {
  if (!requireAdmin()) return;
  activityStack = [];
  saveData();
  renderHistory();
  showToast("Activity history cleared.");
});

document.getElementById("modalContent").addEventListener("input", event => {
  if (event.target.name === "quantity" && Number(event.target.value) < 1) event.target.setCustomValidity("Quantity must be greater than zero.");
  else if (event.target.name === "quantity") event.target.setCustomValidity("");
  if (event.target.name === "purchasePrice" && Number(event.target.value) < 0) event.target.setCustomValidity("Price cannot be negative.");
  else if (event.target.name === "purchasePrice") event.target.setCustomValidity("");
});

document.addEventListener("keydown", event => {
  if (event.key === "Enter" && event.target.matches("#searchInput")) document.getElementById("searchForm").requestSubmit();
});

restoreSession();