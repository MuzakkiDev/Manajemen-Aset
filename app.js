/* ============================================================
   app.js — Logika Frontend Sistem Manajemen Aset
   ============================================================ */

// ---------- STATE ----------
const state = {
  apiUrl:
    localStorage.getItem("apiUrl") ||
    "https://script.google.com/macros/s/AKfycbzGewWP1Q868Txniv1_n4v2luC9F1RcAJKyFbhcCBqDWjWgrkjuSoeKVA9M9vxmoQws/exec",
  token: localStorage.getItem("token") || "",
  user: JSON.parse(localStorage.getItem("user") || "null"),
  currentPage: "home",
  assets: [],
  pagination: { page: 1, pageSize: 20, total: 0 },
  filters: { search: "", kategori: "", kondisi: "", status: "" },
  references: { kategori: [], lokasi: [], kondisi: [], status: [] },
  selectedAsset: null,
  formMode: "manual", // 'manual' | 'scan'
  editingId: null,
  qrScanner: null,
  scanTarget: "list", // 'list' | 'form'
};

const ADMIN_ROLE = "Admin";
const MAX_IMG_SIZE = 1280;
const JPEG_QUALITY = 0.7;

// ---------- DOM HELPER ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ============================================================
// 1. API LAYER (fetch ke GAS — text/plain untuk hindari CORS preflight)
// ============================================================
async function api(action, data = {}) {
  if (!state.apiUrl) throw new Error("URL API belum diisi.");
  showLoading(true);
  try {
    const res = await fetch(state.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: state.token, ...data }),
    });
    const json = await res.json();
    if (json.success === false && json.code === 401) {
      handleSessionExpired();
    }
    return json;
  } catch (err) {
    return {
      success: false,
      message: "Gagal terhubung ke server: " + err.message,
    };
  } finally {
    showLoading(false);
  }
}

async function apiLogin(username, password) {
  if (!state.apiUrl) throw new Error("URL API belum diisi.");
  showLoading(true);
  try {
    const res = await fetch(state.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "login", username, password }),
    });
    return await res.json();
  } finally {
    showLoading(false);
  }
}

// ============================================================
// 2. TEMA (DARK / LIGHT)
// ============================================================
function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"), false);

  // Ikuti perubahan OS jika pengguna belum memilih manual
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (!localStorage.getItem("theme"))
        applyTheme(e.matches ? "dark" : "light", false);
    });
}

function applyTheme(theme, persist = true) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  if (persist) localStorage.setItem("theme", theme);
  $$(".icon-sun").forEach((el) =>
    el.classList.toggle("hidden", theme !== "dark"),
  );
  $$(".icon-moon").forEach((el) =>
    el.classList.toggle("hidden", theme === "dark"),
  );
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains("dark");
  applyTheme(isDark ? "light" : "dark");
}

// ============================================================
// 3. NAVIGASI & ROUTING HALAMAN
// ============================================================
function showPage(name) {
  if (!state.token && name !== "login") name = "login";
  state.currentPage = name;

  $$(".page").forEach((p) => p.classList.add("hidden"));
  const page = $(`#page-${name}`);
  if (page) page.classList.remove("hidden");

  // Highlight menu aktif
  $$("[data-nav]").forEach((b) =>
    b.classList.toggle("active", b.dataset.nav === name),
  );

  // Navbar hanya tampil saat login
  const loggedIn = !!state.token;
  $("#topNav").classList.toggle("hidden", !loggedIn);
  $("#bottomNav").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    $("#topNav").classList.add("md:flex");
    $("#bottomNav").classList.add("md:hidden");
  }

  // Muat data halaman
  switch (name) {
    case "home":
      loadDashboard();
      break;
    case "scan":
      break;
    case "assets":
      loadAssets();
      break;
    case "logs":
      loadLogs();
      break;
    case "users":
      loadUsers();
      break;
    case "ref":
      loadReferences(true);
      break;
    case "profile":
      renderProfile();
      break;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindNavigation() {
  $$("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.adminOnly === "true" && !isAdmin())
        return toast("Akses khusus Admin", "error");
      if (btn.dataset.nav === "scan") stopScanner(); // reset scanner saat pindah
      showPage(btn.dataset.nav);
    });
  });
}

// ============================================================
// 4. AUTENTIKASI
// ============================================================
function isAdmin() {
  return state.user && state.user.role === ADMIN_ROLE;
}

function applyRoleUI() {
  document.body.classList.toggle("is-staff", !isAdmin());
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  localStorage.setItem("apiUrl", state.apiUrl);
  applyRoleUI();
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

async function handleLogin(e) {
  e.preventDefault();
  const apiUrl = $("#apiUrl").value.trim();
  const username = $("#loginUser").value.trim();
  const password = $("#loginPass").value;
  const errEl = $("#loginError");
  errEl.classList.add("hidden");

  state.apiUrl = apiUrl;
  localStorage.setItem("apiUrl", apiUrl);

  const res = await apiLogin(username, password);
  if (!res.success) {
    errEl.textContent = res.message || "Login gagal.";
    errEl.classList.remove("hidden");
    return;
  }
  saveSession(res.token, res.data);
  toast("Selamat datang, " + res.data.nama);
  showPage("home");
}

async function handleLogout() {
  if (state.token) await api("logout");
  clearSession();
  toast("Anda telah keluar.");
  showPage("login");
}

function handleSessionExpired() {
  clearSession();
  toast("Sesi berakhir, silakan login kembali.", "error");
  showPage("login");
}

function renderProfile() {
  if (!state.user) return;
  $("#profName").textContent = state.user.nama;
  $("#profUser").textContent = state.user.username;
  $("#profRole").textContent = state.user.role;
}

async function handleChangePassword(e) {
  e.preventDefault();
  const res = await api("changePassword", {
    data: {
      oldPassword: $("#oldPass").value,
      newPassword: $("#newPass").value,
    },
  });
  toast(res.message, res.success ? "success" : "error");
  if (res.success) $("#changePassForm").reset();
}

// ============================================================
// 5. DASHBOARD
// ============================================================
async function loadDashboard() {
  const res = await api("getAssets", { pageSize: 500 });
  if (!res.success) return;
  const items = res.data;
  $("#statTotal").textContent = items.length;
  $("#statAktif").textContent = items.filter(
    (a) => a.Status === "Aktif",
  ).length;
  $("#statMaint").textContent = items.filter(
    (a) => a.Status === "Maintenance",
  ).length;
  $("#statRusak").textContent = items.filter((a) =>
    String(a.Kondisi).startsWith("Rusak"),
  ).length;

  const logs = await api("getLogs", { limit: 5 });
  const ul = $("#recentLogs");
  ul.innerHTML = "";
  (logs.data || []).forEach((l) => {
    const li = document.createElement("li");
    li.className = "py-2 flex justify-between gap-2";
    li.innerHTML = `<span><strong>${escapeHtml(l.Nama_Aset)}</strong> — ${escapeHtml(l.Jenis_Aktivitas)}</span>
                    <span class="text-gray-500 text-xs">${formatDate(l.Tanggal)}</span>`;
    ul.appendChild(li);
  });
}

// ============================================================
// 6. DAFTAR ASET
// ============================================================
async function loadAssets() {
  const params = {
    search: $("#searchAsset").value.trim(),
    kategori: $("#filterKategori").value,
    kondisi: $("#filterKondisi").value,
    status: $("#filterStatus").value,
    page: state.pagination.page,
    pageSize: state.pagination.pageSize,
  };
  const res = await api("getAssets", params);
  if (!res.success) return toast(res.message, "error");

  state.assets = res.data;
  state.pagination = { ...state.pagination, total: res.pagination.total };
  renderAssetTable();
  $("#pageInfo").textContent =
    `Halaman ${state.pagination.page} · Total ${state.pagination.total}`;
}

function renderAssetTable() {
  const tbody = $("#assetTableBody");
  tbody.innerHTML = "";
  if (!state.assets.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="td text-center text-gray-500">Tidak ada data aset.</td></tr>`;
    return;
  }
  state.assets.forEach((a) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer";
    tr.innerHTML = `
      <td class="td font-mono text-xs">${escapeHtml(a.Kode_QR)}</td>
      <td class="td">${escapeHtml(a.Nama_Aset)}</td>
      <td class="td">${escapeHtml(a.Kategori)}</td>
      <td class="td">${escapeHtml(a.Lokasi)}</td>
      <td class="td">${escapeHtml(a.Kondisi)}</td>
      <td class="td"><span class="badge">${escapeHtml(a.Status)}</span></td>
      <td class="td"><button class="btn-secondary text-xs px-2 py-1" data-detail="${escapeHtml(a.ID_Aset)}">Detail</button></td>`;
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button") || true) openAssetDetail(a.Kode_QR);
    });
    tbody.appendChild(tr);
  });
}

function bindAssetList() {
  let timer;
  $("#searchAsset").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.pagination.page = 1;
      loadAssets();
    }, 400);
  });
  ["#filterKategori", "#filterKondisi", "#filterStatus"].forEach((sel) =>
    $(sel).addEventListener("change", () => {
      state.pagination.page = 1;
      loadAssets();
    }),
  );
  $("#prevPage").addEventListener("click", () => {
    if (state.pagination.page > 1) {
      state.pagination.page--;
      loadAssets();
    }
  });
  $("#nextPage").addEventListener("click", () => {
    const max = Math.ceil(state.pagination.total / state.pagination.pageSize);
    if (state.pagination.page < max) {
      state.pagination.page++;
      loadAssets();
    }
  });
  $("#btnAddAsset").addEventListener("click", () => openAssetForm());
}

// ============================================================
// 7. DETAIL ASET (MODAL) + STOCK OPNAME + PERGERAKAN
// ============================================================
async function openAssetDetail(kodeQr) {
  const res = await api("getAssetByCode", { kodeQr });
  if (!res.success) return toast(res.message, "error");
  state.selectedAsset = res.data;

  const a = res.data;
  $("#modalTitle").textContent = a.Nama_Aset;
  $("#modalBody").innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      ${detailRow("Kode QR", a.Kode_QR)}
      ${detailRow("Kategori", a.Kategori)}
      ${detailRow("Merk / Tipe", a.Merk_Tipe)}
      ${detailRow("Spesifikasi", a.Spesifikasi_Detail)}
      ${detailRow("No. Seri / Mesin", a.No_Seri_atau_Mesin)}
      ${detailRow("Plat Nomor", a.Plat_Nomor)}
      ${detailRow("Tahun", a.Tahun_Pembuatan)}
      ${detailRow("Tanggal Beli", formatDate(a.Tanggal_Beli))}
      ${detailRow("Harga", formatRupiah(a.Harga_Perolehan))}
      ${detailRow("Garansi / STNK", formatDate(a.Batas_Garansi_atau_STNK))}
      ${detailRow("Jadwal Maintenance", formatDate(a.Jadwal_Maintenance))}
      ${detailRow("Lokasi", a.Lokasi)}
      ${detailRow("PIC", a.PIC_Penanggung_Jawab)}
      ${detailRow("Kondisi", a.Kondisi)}
      ${detailRow("Status", a.Status)}
      ${detailRow("Terakhir Audit", formatDate(a.Terakhir_Audit))}
    </div>
    ${a.Link_Foto ? `<a href="${a.Link_Foto}" target="_blank" class="text-blue-600 underline">Lihat Foto</a>` : ""}
    ${a.Link_Dokumen ? `<a href="${a.Link_Dokumen}" target="_blank" class="text-blue-600 underline ml-3">Lihat Dokumen</a>` : ""}
    <p class="text-gray-500">${escapeHtml(a.Catatan || "")}</p>`;

  $("#assetModal").classList.add("open");
  $("#assetModal").classList.remove("hidden");
  applyRoleUI();
}

function detailRow(label, value) {
  return `<div><p class="text-xs text-gray-500">${label}</p><p class="font-medium break-words">${escapeHtml(String(value ?? "-")) || "-"}</p></div>`;
}

function closeModal() {
  $("#assetModal").classList.remove("open");
  $("#assetModal").classList.add("hidden");
  state.selectedAsset = null;
}

async function handleStockOpname() {
  const a = state.selectedAsset;
  if (!a) return;
  const kondisi = prompt(
    `Kondisi terkini untuk "${a.Nama_Aset}"?\n(Baik / Rusak Ringan / Rusak Berat)`,
    a.Kondisi,
  );
  if (kondisi === null) return;
  const keterangan = prompt("Catatan opname (opsional):", "Audit rutin") || "";
  const res = await api("stockOpname", {
    kodeQr: a.Kode_QR,
    kondisi,
    keterangan,
  });
  toast(res.message, res.success ? "success" : "error");
  if (res.success) openAssetDetail(a.Kode_QR);
}

async function handleMoveAsset() {
  const a = state.selectedAsset;
  if (!a) return;
  const lokasiBaru = prompt(`Pindah "${a.Nama_Aset}" ke lokasi:`, a.Lokasi);
  if (lokasiBaru === null) return;
  const picBaru =
    prompt("PIC baru:", a.PIC_Penanggung_Jawab) ?? a.PIC_Penanggung_Jawab;
  const res = await api("moveAsset", {
    kodeQr: a.Kode_QR,
    lokasiBaru,
    picBaru,
  });
  toast(res.message, res.success ? "success" : "error");
  if (res.success) openAssetDetail(a.Kode_QR);
}

async function handleDeleteAsset() {
  const a = state.selectedAsset;
  if (!a || !confirm(`Arsipkan aset "${a.Nama_Aset}"?`)) return;
  const res = await api("deleteAsset", { ID_Aset: a.ID_Aset });
  toast(res.message, res.success ? "success" : "error");
  if (res.success) {
    closeModal();
    loadAssets();
  }
}

function printQrLabel() {
  const a = state.selectedAsset;
  if (!a) return;
  let area = $("#printArea");
  if (!area) {
    area = document.createElement("div");
    area.id = "printArea";
    document.body.appendChild(area);
  }
  area.innerHTML = `
    <div class="qr-label">
      <div id="qrPrint-${a.ID_Aset}"></div>
      <div class="qr-title">${escapeHtml(a.Nama_Aset)}</div>
      <div class="qr-code">${escapeHtml(a.Kode_QR)}</div>
    </div>`;
  new QRCode(document.getElementById(`qrPrint-${a.ID_Aset}`), {
    text: a.Kode_QR,
    width: 110,
    height: 110,
    correctLevel: QRCode.CorrectLevel.M,
  });
  setTimeout(() => window.print(), 300);
}

// ============================================================
// 8. FORM ASET (TAMBAH / EDIT) — Mode Manual & Scan QR
// ============================================================
function openAssetForm(asset = null) {
  state.editingId = asset ? asset.ID_Aset : null;
  $("#formTitle").textContent = asset ? "Edit Aset" : "Tambah Aset";
  const form = $("#assetForm");
  form.reset();
  form.ID_Aset.value = asset ? asset.ID_Aset : "";

  if (asset) {
    Object.keys(asset).forEach((k) => {
      const el = form.elements[k];
      if (el && el.type !== "file") el.value = formatInputValue(el, asset[k]);
    });
  }
  setFormMode("manual");
  showPage("asset-form");
  // showPage memanggil fungsi load; halaman form tidak punya loader → tidak masalah
}

function setFormMode(mode) {
  state.formMode = mode;
  $("#modeManual").className =
    mode === "manual" ? "btn-primary flex-1" : "btn-secondary flex-1";
  $("#modeScan").className =
    mode === "scan" ? "btn-primary flex-1" : "btn-secondary flex-1";
  $("#qrCodeWrap").classList.toggle("hidden", mode === "scan" && false);
  if (mode === "manual") {
    $("#assetForm").Kode_QR.placeholder = "Kosongkan untuk auto-generate";
  } else {
    $("#assetForm").Kode_QR.placeholder = 'Klik "Scan Kode" untuk memindai';
  }
}

function formatInputValue(el, value) {
  if (el.type === "date" && value) {
    const d = new Date(value);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return value ?? "";
}

function populateFormSelects() {
  const form = $("#assetForm");
  fillSelect(form.Kategori, state.references.kategori, true);
  fillSelect(form.Lokasi, state.references.lokasi);
  fillSelect(form.Kondisi, state.references.kondisi);
  fillSelect(form.Status, state.references.status);
}

function fillSelect(select, options, placeholder = false) {
  select.innerHTML = placeholder ? '<option value="">-- Pilih --</option>' : "";
  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    select.appendChild(opt);
  });
}

/** Sembunyikan/tampilkan field berdasarkan kategori terpilih. */
function applyDynamicFields() {
  const kategori = $("#assetForm").Kategori.value;
  $$(".field-dynamic").forEach((wrap) => {
    const hideFor = wrap.dataset.hideFor;
    const onlyFor = wrap.dataset.onlyFor;
    let show = true;
    if (hideFor && kategori === hideFor) show = false;
    if (onlyFor && kategori !== onlyFor) show = false;
    wrap.classList.toggle("field-hidden", !show);
    // Kosongkan nilai agar tidak terkirim saat tersembunyi
    wrap.querySelectorAll("input, select, textarea").forEach((i) => {
      if (!show) i.value = "";
    });
  });
}

/** Kompresi gambar via Canvas → Base64 (max 1280px, quality 0.7). */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith("image/")) return resolve(fileToBase64(file)); // PDF: kirim apa adanya

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(
          1,
          MAX_IMG_SIZE / Math.max(img.width, img.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas
          .getContext("2d")
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
          name: file.name,
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ base64: r.result, name: file.name });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function handleAssetSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {};
  Array.from(form.elements).forEach((el) => {
    if (!el.name || el.type === "file" || el.closest(".field-hidden")) return;
    payload[el.name] = el.value;
  });

  // Kompres file bila ada
  const foto = form.foto.files[0];
  const dok = form.dokumen.files[0];
  if (foto) {
    const c = await compressImage(foto);
    payload.fotoBase64 = c.base64;
    payload.fotoName = c.name;
  }
  if (dok) {
    const c = await compressImage(dok);
    payload.dokBase64 = c.base64;
    payload.dokName = c.name;
  }

  // Aksi: create atau update
  const action = state.editingId ? "updateAsset" : "createAsset";
  const body = state.editingId
    ? { ...payload, ID_Aset: state.editingId }
    : { data: payload };
  const res = await api(action, state.editingId ? { data: body } : body);
  toast(res.message, res.success ? "success" : "error");

  if (res.success) {
    state.editingId = null;
    showPage("assets");
  }
}

// ============================================================
// 9. SCAN QR (Kamera via html5-qrcode)
// ============================================================
async function startScanner(target = "list") {
  if (state.qrScanner) return;
  state.scanTarget = target;
  const Html5Qrcode = window.Html5Qrcode;
  state.qrScanner = new Html5Qrcode("qrReader");
  try {
    await state.qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      onQrSuccess,
      () => {},
    );
    $("#btnStartScan").classList.add("hidden");
    $("#btnStopScan").classList.remove("hidden");
  } catch (err) {
    toast("Kamera tidak dapat diakses: " + err, "error");
    state.qrScanner = null;
  }
}

async function stopScanner() {
  if (!state.qrScanner) return;
  try {
    await state.qrScanner.stop();
    await state.qrScanner.clear();
  } catch (_) {}
  state.qrScanner = null;
  $("#btnStartScan").classList.remove("hidden");
  $("#btnStopScan").classList.add("hidden");
}

async function onQrSuccess(decodedText) {
  await stopScanner();
  if (state.scanTarget === "form") {
    $("#assetForm").Kode_QR.value = decodedText.trim();
    toast("Kode QR terbaca: " + decodedText);
    return;
  }
  // Mode scan cepat: tampilkan detail aset
  openAssetDetail(decodedText.trim());
}

function bindScan() {
  $("#btnStartScan").addEventListener("click", () => startScanner("list"));
  $("#btnStopScan").addEventListener("click", stopScanner);
  $("#manualScanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#manualCode").value.trim();
    if (code) openAssetDetail(code);
  });
  $("#btnFillQr").addEventListener("click", () => {
    state.scanTarget = "form";
    setFormMode("scan");
    startScanner("form");
  });
}

// ============================================================
// 10. RIWAYAT, PENGGUNA, REFERENSI
// ============================================================
async function loadLogs() {
  const res = await api("getLogs", { limit: 200 });
  const tbody = $("#logTableBody");
  tbody.innerHTML = "";
  (res.data || []).forEach((l) => {
    tbody.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td class="td whitespace-nowrap">${formatDate(l.Tanggal, true)}</td>
        <td class="td">${escapeHtml(l.Nama_Aset)}<div class="text-xs text-gray-500 font-mono">${escapeHtml(l.Kode_QR)}</div></td>
        <td class="td">${escapeHtml(l.Jenis_Aktivitas)}</td>
        <td class="td">${escapeHtml(l.Lokasi_Baru || l.Lokasi_Lama || "-")}</td>
        <td class="td">${escapeHtml(l.Kondisi || "-")}</td>
        <td class="td">${escapeHtml(l.Petugas)}</td>
      </tr>`,
    );
  });
}

async function loadUsers() {
  const res = await api("getUsers");
  const tbody = $("#userTableBody");
  tbody.innerHTML = "";
  (res.data || []).forEach((u) => {
    tbody.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td class="td">${escapeHtml(u.Username)}</td>
        <td class="td">${escapeHtml(u.Nama_Lengkap)}</td>
        <td class="td"><span class="badge">${escapeHtml(u.Role)}</span></td>
        <td class="td">${escapeHtml(u.Status_Aktif)}</td>
        <td class="td"><button class="btn-secondary text-xs px-2 py-1" data-reset="${escapeHtml(u.Username)}">Reset Password</button></td>
      </tr>`,
    );
  });
}

async function handleAddUser() {
  const username = prompt("Username baru:");
  if (!username) return;
  const password = prompt("Password (min 6 karakter):");
  if (!password) return;
  const nama = prompt("Nama lengkap:", username) || username;
  const role = prompt("Role (Admin / Staff):", "Staff");
  const res = await api("createUser", {
    data: { username, password, nama, role },
  });
  toast(res.message, res.success ? "success" : "error");
  loadUsers();
}

async function handleUserTableClick(e) {
  const btn = e.target.closest("[data-reset]");
  if (!btn) return;
  const pw = prompt(`Password baru untuk ${btn.dataset.reset}:`);
  if (!pw) return;
  const res = await api("resetPassword", {
    data: { username: btn.dataset.reset, newPassword: pw },
  });
  toast(res.message, res.success ? "success" : "error");
}

async function loadReferences(render = false) {
  const res = await api("getReferences");
  if (!res.success) return;
  state.references = res.data;
  fillFilterSelects();
  if (render) renderRefGrid();
}

function fillFilterSelects() {
  const { kategori, kondisi, status } = state.references;
  fillSelect($("#filterKategori"), kategori);
  fillSelect($("#filterKondisi"), kondisi);
  fillSelect($("#filterStatus"), status);
  $("#filterKategori").insertAdjacentHTML(
    "afterbegin",
    '<option value="">Semua Kategori</option>',
  );
  $("#filterKondisi").insertAdjacentHTML(
    "afterbegin",
    '<option value="">Semua Kondisi</option>',
  );
  $("#filterStatus").insertAdjacentHTML(
    "afterbegin",
    '<option value="">Semua Status</option>',
  );
  populateFormSelects();
}

function renderRefGrid() {
  const grid = $("#refGrid");
  grid.innerHTML = "";
  ["kategori", "lokasi", "kondisi", "status"].forEach((type) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="flex justify-between items-center mb-3">
        <h2 class="font-semibold capitalize">${type}</h2>
        <button class="btn-primary text-xs px-3 py-1" data-add-ref="${type}">+ Tambah</button>
      </div>
      <ul class="space-y-1 text-sm">
        ${state.references[type]
          .map(
            (v) => `
          <li class="flex justify-between items-center py-1 border-b dark:border-gray-700">
            <span>${escapeHtml(v)}</span>
            <button class="text-red-500 text-xs" data-del-ref="${type}" data-val="${escapeHtml(v)}">Hapus</button>
          </li>`,
          )
          .join("")}
      </ul>`;
    grid.appendChild(card);
  });
}

async function handleRefClick(e) {
  const add = e.target.closest("[data-add-ref]");
  const del = e.target.closest("[data-del-ref]");
  if (add) {
    const value = prompt(`Nilai baru untuk ${add.dataset.addRef}:`);
    if (!value) return;
    const res = await api("addReference", {
      data: { type: add.dataset.addRef, value },
    });
    toast(res.message, res.success ? "success" : "error");
    await loadReferences(true);
  }
  if (del) {
    if (!confirm(`Hapus "${del.dataset.val}"?`)) return;
    const res = await api("deleteReference", {
      data: { type: del.dataset.delRef, value: del.dataset.val },
    });
    toast(res.message, res.success ? "success" : "error");
    await loadReferences(true);
  }
}

// ============================================================
// 11. UTILITAS UI
// ============================================================
function toast(msg, type = "success") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `fixed top-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg text-white text-sm ${type === "error" ? "bg-red-600" : "bg-green-600"}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3000);
}

function showLoading(on) {
  const el = $("#loading");
  el.classList.toggle("hidden", !on);
  el.classList.toggle("flex", on);
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function formatDate(v, withTime = false) {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  const opts = withTime
    ? {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    : { day: "2-digit", month: "short", year: "numeric" };
  return d.toLocaleString("id-ID", opts);
}

function formatRupiah(n) {
  if (n === "" || n === null || n === undefined) return "-";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

// ============================================================
// 12. INISIALISASI
// ============================================================
function bindEvents() {
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#changePassForm").addEventListener("submit", handleChangePassword);
  $("#assetForm").addEventListener("submit", handleAssetSubmit);
  $("#assetForm").Kategori.addEventListener("change", applyDynamicFields);
  $("#modeManual").addEventListener("click", () => setFormMode("manual"));
  $("#modeScan").addEventListener("click", () => {
    setFormMode("scan");
    toast('Klik "Scan Kode" untuk memindai QR.');
  });
  $("#btnCancelForm").addEventListener("click", () => showPage("assets"));

  $("#modalClose").addEventListener("click", closeModal);
  $("#btnStockOpname").addEventListener("click", handleStockOpname);
  $("#btnMove").addEventListener("click", handleMoveAsset);
  $("#btnDeleteAsset").addEventListener("click", handleDeleteAsset);
  $("#btnEditAsset").addEventListener("click", () => {
    const a = state.selectedAsset;
    closeModal();
    openAssetForm(a);
  });
  $("#btnPrintQr").addEventListener("click", printQrLabel);

  $("#btnAddUser").addEventListener("click", handleAddUser);
  $("#userTableBody").addEventListener("click", handleUserTableClick);
  $("#refGrid").addEventListener("click", handleRefClick);

  $("#themeToggleDesktop").addEventListener("click", toggleTheme);
  $("#themeToggleMobile").addEventListener("click", toggleTheme);
  $("#logoutDesktop").addEventListener("click", handleLogout);
  $("#btnLogoutProfile").addEventListener("click", handleLogout);

  bindNavigation();
  bindAssetList();
  bindScan();
}

function init() {
  initTheme();
  bindEvents();
  $("#apiUrl").value = state.apiUrl;
  applyRoleUI();

  if (state.token && state.user) {
    showPage("home");
    loadReferences(false);
  } else {
    showPage("login");
  }
}

document.addEventListener("DOMContentLoaded", init);
