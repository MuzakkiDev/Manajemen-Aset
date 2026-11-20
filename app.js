// app.js
import { supabase } from "./supabase-config.js";

// ==========================================
// GLOBAL STATE
// ==========================================
let currentUser = null; // { uid, username_id, email, nama_lengkap, role }
let allAssets = []; // Cache daftar aset dari PostgreSQL
let selectedAsset = null; // Aset yang sedang dibuka di modal detail
let mainScanner = null; // Instance html5-qrcode untuk menu Scan Cepat
let formScanner = null; // Instance html5-qrcode untuk form Tambah Aset

// ==========================================
// UTILITY & HELPER FUNCTIONS
// ==========================================
const $ = (id) => document.getElementById(id);

function showLoading(text = "Memproses data...") {
  $("loading-text").textContent = text;
  $("loading-overlay").classList.remove("hidden");
}

function hideLoading() {
  $("loading-overlay").classList.add("hidden");
}

function showToast(message, type = "success") {
  const container = $("toast-container");
  const toast = document.createElement("div");
  const bgClass =
    type === "error"
      ? "bg-red-600 text-white"
      : type === "warning"
        ? "bg-amber-500 text-white"
        : "bg-slate-800 dark:bg-slate-700 text-white";

  toast.className = `${bgClass} px-4 py-3 rounded-xl shadow-lg text-xs font-medium pointer-events-auto transition-all duration-300 transform translate-y-0 opacity-100`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("opacity-0", "-translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatRupiah(angka) {
  const num = Number(angka) || 0;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(num);
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return String(ts);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function generateAutoQR() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `AST-${y}${m}${d}-${rand}`;
}

function compressImage(file, maxWidth = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Gagal mengompres gambar"));
          },
          "image/jpeg",
          quality,
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// ==========================================
// DARK / LIGHT MODE CONTROLLER
// ==========================================
function initThemeToggle() {
  document.querySelectorAll(".btn-toggle-theme").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isDark = document.documentElement.classList.toggle("dark");
      localStorage.setItem("theme", isDark ? "dark" : "light");
    });
  });
}

// ==========================================
// SUPABASE AUTHENTICATION & RBAC (ID LOGIN)
// ==========================================
async function handleUserSession(session) {
  if (!session || !session.user) {
    currentUser = null;
    stopAllScanners();
    $("app-section").classList.add("hidden");
    $("login-section").classList.remove("hidden");
    return;
  }

  showLoading("Memverifikasi profil pengguna...");
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (error || !profile) {
      await supabase.auth.signOut();
      showToast("Profil user belum terdaftar di tabel profiles.", "error");
      return;
    }

    if (profile.status_aktif !== true) {
      await supabase.auth.signOut();
      showToast("Akun Anda dinonaktifkan oleh Admin.", "error");
      return;
    }

    currentUser = {
      uid: session.user.id,
      username_id:
        profile.username_id || session.user.email.split("@")[0].toUpperCase(),
      email: session.user.email,
      nama_lengkap: profile.nama_lengkap || profile.username_id,
      role: profile.role || "Staff",
    };

    setupUIByRole();
    $("login-section").classList.add("hidden");
    $("app-section").classList.remove("hidden");

    await loadAllData();

    if (currentUser.role === "Admin") {
      switchView("dashboard");
    } else {
      switchView("scan");
    }
  } catch (err) {
    console.error("Session error:", err);
    showToast("Terjadi kesalahan sesi: " + err.message, "error");
  } finally {
    hideLoading();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  handleUserSession(session);
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const userIdInput = $("login-id").value.trim().toLowerCase();
  const password = $("login-password").value;
  const errBox = $("login-error");

  // Mapping ID Pengguna ke virtual email internal Supabase
  const virtualEmail = `${userIdInput}@aset.local`;

  errBox.classList.add("hidden");
  showLoading("Sedang masuk...");

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: virtualEmail,
      password,
    });
    if (error) throw error;
    $("login-form").reset();
  } catch (error) {
    errBox.textContent = "ID Pengguna atau password salah.";
    errBox.classList.remove("hidden");
  } finally {
    hideLoading();
  }
});

document.querySelectorAll(".btn-logout").forEach((btn) => {
  btn.addEventListener("click", async () => {
    stopAllScanners();
    await supabase.auth.signOut();
    showToast("Anda telah keluar dari sistem.");
  });
});

function setupUIByRole() {
  const isAdmin = currentUser.role === "Admin";

  $("desktop-user-name").textContent =
    `${currentUser.nama_lengkap} (${currentUser.username_id})`;
  $("desktop-user-role").textContent = currentUser.role;
  $("mobile-user-info").textContent =
    `${currentUser.username_id} • ${currentUser.role}`;

  document.querySelectorAll(".admin-only").forEach((el) => {
    if (isAdmin) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// ==========================================
// NAVIGATION & VIEW SWITCHER
// ==========================================
function switchView(viewName) {
  if (
    currentUser?.role !== "Admin" &&
    (viewName === "dashboard" || viewName === "form")
  ) {
    viewName = "scan";
  }

  if (viewName !== "scan") stopMainScanner();
  if (viewName !== "form") stopFormScanner();

  document
    .querySelectorAll(".app-view")
    .forEach((v) => v.classList.add("hidden"));
  const targetView = $(`view-${viewName}`);
  if (targetView) targetView.classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    if (btn.dataset.nav === viewName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  lucide.createIcons();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.nav;
    if (target === "form") resetAsetForm();
    switchView(target);
  });
});

// ==========================================
// LOAD DATA DARI POSTGRESQL SUPABASE
// ==========================================
async function loadAllData() {
  showLoading("Memuat data aset...");
  try {
    const { data, error } = await supabase
      .from("master_aset")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    allAssets = data || [];
    populateLocationFilters();
    renderAssetList();

    if (currentUser.role === "Admin") {
      updateDashboardKPI();
      await loadRecentLogs();
    }
  } catch (error) {
    console.error("Load data error:", error);
    showToast("Gagal memuat daftar aset: " + error.message, "error");
  } finally {
    hideLoading();
  }
}

$("btn-refresh-data")?.addEventListener("click", loadAllData);

function populateLocationFilters() {
  const lokasiSet = new Set();
  allAssets.forEach((a) => {
    if (a.lokasi) lokasiSet.add(a.lokasi.trim());
  });

  const filterSelect = $("filter-lokasi");
  const dataList = $("list-lokasi-options");

  filterSelect.innerHTML = '<option value="">Semua Lokasi</option>';
  dataList.innerHTML = "";

  Array.from(lokasiSet)
    .sort()
    .forEach((lok) => {
      const opt = document.createElement("option");
      opt.value = lok;
      opt.textContent = lok;
      filterSelect.appendChild(opt);

      const dlOpt = document.createElement("option");
      dlOpt.value = lok;
      dataList.appendChild(dlOpt);
    });
}

// ==========================================
// DASHBOARD KPI & LOG TERBARU (ADMIN)
// ==========================================
function updateDashboardKPI() {
  const totalAset = allAssets.length;
  let totalNilai = 0;
  let kondisiBaik = 0;
  let kondisiRusak = 0;

  allAssets.forEach((aset) => {
    totalNilai += Number(aset.harga_perolehan) || 0;
    if (aset.kondisi === "Baik") {
      kondisiBaik++;
    } else {
      kondisiRusak++;
    }
  });

  $("kpi-total-aset").textContent = totalAset;
  $("kpi-total-nilai").textContent = formatRupiah(totalNilai);
  $("kpi-kondisi-baik").textContent = kondisiBaik;
  $("kpi-kondisi-rusak").textContent = kondisiRusak;
}

async function loadRecentLogs() {
  const container = $("dashboard-recent-logs");
  try {
    const { data, error } = await supabase
      .from("log_aktivitas")
      .select("*")
      .order("tanggal", { ascending: false })
      .limit(8);

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML =
        '<p class="text-slate-400 py-4 text-center">Belum ada aktivitas tercatat.</p>';
      return;
    }

    container.innerHTML = data
      .map(
        (log) => `
        <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <span class="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">${escapeHTML(log.kode_qr)}</span>
            <span class="font-medium ml-1.5">${escapeHTML(log.nama_aset)}</span>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span class="font-semibold">${escapeHTML(log.jenis_aktivitas)}</span> — ${escapeHTML(log.keterangan || "-")}
            </p>
          </div>
          <div class="text-left sm:text-right text-xs text-slate-400 shrink-0">
            <p class="font-medium text-slate-600 dark:text-slate-300">${escapeHTML(log.petugas_nama)}</p>
            <p>${formatTimestamp(log.tanggal)}</p>
          </div>
        </div>
      `,
      )
      .join("");
  } catch (err) {
    console.error("Gagal memuat log:", err);
  }
}

// ==========================================
// RENDER DAFTAR ASET & FILTER
// ==========================================
function getKondisiBadge(kondisi) {
  switch (kondisi) {
    case "Baik":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "Rusak Ringan":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "Rusak Berat":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    default:
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  }
}

function getFilteredAssets() {
  const search = $("filter-search").value.trim().toLowerCase();
  const kategori = $("filter-kategori").value;
  const lokasi = $("filter-lokasi").value;
  const kondisi = $("filter-kondisi").value;

  return allAssets.filter((item) => {
    const matchSearch =
      !search ||
      (item.nama_aset && item.nama_aset.toLowerCase().includes(search)) ||
      (item.kode_qr && item.kode_qr.toLowerCase().includes(search)) ||
      (item.pic_penanggung_jawab &&
        item.pic_penanggung_jawab.toLowerCase().includes(search)) ||
      (item.plat_nomor && item.plat_nomor.toLowerCase().includes(search));

    const matchKategori = !kategori || item.kategori === kategori;
    const matchLokasi = !lokasi || item.lokasi === lokasi;
    const matchKondisi = !kondisi || item.kondisi === kondisi;

    return matchSearch && matchKategori && matchLokasi && matchKondisi;
  });
}

function renderAssetList() {
  const filtered = getFilteredAssets();
  const tbody = $("aset-table-body");
  const mobileList = $("aset-mobile-list");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">Tidak ada aset yang sesuai filter.</td></tr>`;
    mobileList.innerHTML = `<div class="bg-white dark:bg-slate-800 p-6 rounded-2xl text-center text-sm text-slate-400 border border-slate-200 dark:border-slate-700">Tidak ada aset yang sesuai filter.</div>`;
    return;
  }

  let tableHtml = "";
  let mobileHtml = "";

  filtered.forEach((aset) => {
    const badgeClass = getKondisiBadge(aset.kondisi);
    const subInfo = aset.plat_nomor
      ? ` • ${escapeHTML(aset.plat_nomor)}`
      : aset.merk_tipe
        ? ` • ${escapeHTML(aset.merk_tipe)}`
        : "";

    tableHtml += `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
        <td class="py-3 px-4 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">${escapeHTML(aset.kode_qr)}</td>
        <td class="py-3 px-4">
          <div class="font-semibold">${escapeHTML(aset.nama_aset)}</div>
          <div class="text-xs text-slate-400">${escapeHTML(aset.merk_tipe || "-")} ${aset.plat_nomor ? `(${escapeHTML(aset.plat_nomor)})` : ""}</div>
        </td>
        <td class="py-3 px-4 text-xs">${escapeHTML(aset.kategori)}</td>
        <td class="py-3 px-4">
          <div class="text-xs font-medium">${escapeHTML(aset.lokasi)}</div>
          <div class="text-[11px] text-slate-400">PIC: ${escapeHTML(aset.pic_penanggung_jawab)}</div>
        </td>
        <td class="py-3 px-4">
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${badgeClass}">${escapeHTML(aset.kondisi)}</span>
        </td>
        <td class="py-3 px-4 text-right">
          <button data-id="${aset.id}" class="btn-open-detail px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition">
            Detail
          </button>
        </td>
      </tr>
    `;

    mobileHtml += `
      <div data-id="${aset.id}" class="btn-open-detail bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm active:scale-[0.99] transition cursor-pointer">
        <div class="flex justify-between items-start gap-2 mb-1.5">
          <span class="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">${escapeHTML(aset.kode_qr)}</span>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${badgeClass}">${escapeHTML(aset.kondisi)}</span>
        </div>
        <h4 class="font-bold text-base leading-snug">${escapeHTML(aset.nama_aset)}</h4>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">${escapeHTML(aset.kategori)}${subInfo}</p>
        <div class="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700 flex justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>📍 ${escapeHTML(aset.lokasi)}</span>
          <span>👤 ${escapeHTML(aset.pic_penanggung_jawab)}</span>
        </div>
      </div>
    `;
  });

  tbody.innerHTML = tableHtml;
  mobileList.innerHTML = mobileHtml;

  document.querySelectorAll(".btn-open-detail").forEach((el) => {
    el.addEventListener("click", () => {
      const aset = allAssets.find((a) => a.id === el.dataset.id);
      if (aset) openDetailModal(aset);
    });
  });
}

["filter-search", "filter-kategori", "filter-lokasi", "filter-kondisi"].forEach(
  (id) => {
    $(id).addEventListener("input", renderAssetList);
  },
);

$("btn-goto-add")?.addEventListener("click", () => {
  resetAsetForm();
  switchView("form");
});

// ==========================================
// DYNAMIC FORM FIELDS BERDASARKAN KATEGORI
// ==========================================
function updateDynamicFormFields() {
  const kategori = $("input-kategori").value;

  const fSpec = $("field-spesifikasi");
  const fSeri = $("field-no-seri");
  const fPlat = $("field-plat-nomor");
  const fTahun = $("field-tahun");
  const fGaransi = $("field-garansi-stnk");
  const lblGaransi = $("label-garansi-stnk");
  const fMaint = $("field-maintenance");

  fSpec.classList.remove("hidden");
  fSeri.classList.remove("hidden");
  fPlat.classList.add("hidden");
  fTahun.classList.add("hidden");
  fGaransi.classList.add("hidden");
  fMaint.classList.add("hidden");

  if (kategori === "Peralatan IT") {
    $("input-spesifikasi").placeholder =
      "Contoh: Intel i7, RAM 16GB, SSD 512GB";
    $("input-no-seri").placeholder = "Serial Number (S/N)";
    lblGaransi.textContent = "Batas Masa Garansi";
    fGaransi.classList.remove("hidden");
  } else if (kategori === "Mesin Produksi") {
    $("input-spesifikasi").placeholder = "Contoh: Daya 5000W, Kapasitas 2 Ton";
    $("input-no-seri").placeholder = "Nomor Seri Mesin";
    fTahun.classList.remove("hidden");
    fMaint.classList.remove("hidden");
  } else if (kategori === "Kendaraan") {
    fSpec.classList.add("hidden");
    fPlat.classList.remove("hidden");
    $("input-no-seri").placeholder = "Nomor Rangka / Nomor Mesin";
    fTahun.classList.remove("hidden");
    lblGaransi.textContent = "Masa Berlaku STNK / Pajak";
    fGaransi.classList.remove("hidden");
    fMaint.classList.remove("hidden");
  } else {
    $("input-spesifikasi").placeholder =
      "Ukuran / Bahan / Keterangan Spesifikasi";
    $("input-no-seri").placeholder = "Nomor Seri (Jika ada)";
  }
}

$("input-kategori").addEventListener("change", updateDynamicFormFields);

// ==========================================
// FORM TAMBAH & EDIT ASET (ADMIN)
// ==========================================
function resetAsetForm() {
  $("aset-form").reset();
  $("aset-doc-id").value = "";
  $("form-aset-title").textContent = "Tambah Aset Baru";
  $("add-mode-selector").classList.remove("hidden");
  $("input-kode-qr").readOnly = false;
  $("preview-foto").classList.add("hidden");
  $("existing-dokumen-info").classList.add("hidden");
  updateDynamicFormFields();
}

$("btn-cancel-form").addEventListener("click", () => {
  stopFormScanner();
  switchView("aset");
});

$("input-foto").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    $("preview-foto").src = URL.createObjectURL(file);
    $("preview-foto").classList.remove("hidden");
  }
});

$("aset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentUser?.role !== "Admin") return;

  const docId = $("aset-doc-id").value;
  const isEdit = Boolean(docId);

  let kodeQR = $("input-kode-qr").value.trim().toUpperCase();
  if (!kodeQR) kodeQR = generateAutoQR();

  if (!isEdit) {
    const duplicate = allAssets.find((a) => a.kode_qr.toUpperCase() === kodeQR);
    if (duplicate) {
      showToast(
        `Kode QR ${kodeQR} sudah digunakan oleh aset "${duplicate.nama_aset}"!`,
        "error",
      );
      return;
    }
  }

  showLoading(
    isEdit ? "Menyimpan perubahan aset..." : "Menyimpan aset baru...",
  );

  try {
    let urlFoto = isEdit ? selectedAsset?.url_foto || null : null;
    let urlDokumen = isEdit ? selectedAsset?.url_dokumen || null : null;

    // 1. Kompres & Upload Foto ke Supabase Storage
    const fotoFile = $("input-foto").files[0];
    if (fotoFile) {
      showLoading("Mengompres & mengunggah foto...");
      const compressedBlob = await compressImage(fotoFile, 1280, 0.7);
      const fotoPath = `foto/${kodeQR}_${Date.now()}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from("aset-files")
        .upload(fotoPath, compressedBlob, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const { data: pubFoto } = supabase.storage
        .from("aset-files")
        .getPublicUrl(fotoPath);
      urlFoto = pubFoto.publicUrl;
    }

    // 2. Upload Dokumen ke Supabase Storage
    const dokFile = $("input-dokumen").files[0];
    if (dokFile) {
      showLoading("Mengunggah dokumen aset...");
      const safeName = dokFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dokPath = `dokumen/${kodeQR}_${Date.now()}_${safeName}`;

      const { error: dokErr } = await supabase.storage
        .from("aset-files")
        .upload(dokPath, dokFile, { upsert: true });

      if (dokErr) throw dokErr;

      const { data: pubDok } = supabase.storage
        .from("aset-files")
        .getPublicUrl(dokPath);
      urlDokumen = pubDok.publicUrl;
    }

    const payload = {
      kode_qr: kodeQR,
      nama_aset: $("input-nama-aset").value.trim(),
      kategori: $("input-kategori").value,
      merk_tipe: $("input-merk-tipe").value.trim() || null,
      spesifikasi_detail: $("input-spesifikasi").value.trim() || null,
      no_seri_atau_mesin: $("input-no-seri").value.trim() || null,
      plat_nomor: $("input-plat-nomor").value.trim().toUpperCase() || null,
      tahun_pembuatan: $("input-tahun").value.trim() || null,
      tanggal_beli: $("input-tanggal-beli").value || null,
      harga_perolehan: Number($("input-harga").value) || 0,
      batas_garansi_atau_stnk: $("input-garansi-stnk").value || null,
      jadwal_maintenance: $("input-maintenance").value || null,
      lokasi: $("input-lokasi").value.trim(),
      pic_penanggung_jawab: $("input-pic").value.trim(),
      kondisi: $("input-kondisi").value,
      status: $("input-status").value,
      url_foto: urlFoto,
      url_dokumen: urlDokumen,
      catatan: $("input-catatan").value.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (isEdit) {
      const { error: updErr } = await supabase
        .from("master_aset")
        .update(payload)
        .eq("id", docId);
      if (updErr) throw updErr;

      await supabase.from("log_aktivitas").insert({
        id_aset: docId,
        kode_qr: payload.kode_qr,
        nama_aset: payload.nama_aset,
        jenis_aktivitas: "Update Data",
        lokasi_lama: selectedAsset?.lokasi || "-",
        lokasi_baru: payload.lokasi,
        pic_lama: selectedAsset?.pic_penanggung_jawab || "-",
        pic_baru: payload.pic_penanggung_jawab,
        kondisi: payload.kondisi,
        keterangan: "Pembaruan data master aset oleh Admin",
        petugas_nama: `${currentUser.nama_lengkap} (${currentUser.username_id})`,
        petugas_uid: currentUser.uid,
      });

      showToast("Data aset berhasil diperbarui!");
      await loadAllData();
      switchView("aset");
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("master_aset")
        .insert(payload)
        .select()
        .single();
      if (insErr) throw insErr;

      await supabase.from("log_aktivitas").insert({
        id_aset: inserted.id,
        kode_qr: payload.kode_qr,
        nama_aset: payload.nama_aset,
        jenis_aktivitas: "Aset Baru",
        lokasi_lama: "-",
        lokasi_baru: payload.lokasi,
        pic_lama: "-",
        pic_baru: payload.pic_penanggung_jawab,
        kondisi: payload.kondisi,
        keterangan: "Registrasi aset baru",
        petugas_nama: `${currentUser.nama_lengkap} (${currentUser.username_id})`,
        petugas_uid: currentUser.uid,
      });

      showToast("Aset baru berhasil ditambahkan!");
      await loadAllData();
      switchView("aset");
      openQRModal(payload.kode_qr, payload.nama_aset);
    }
  } catch (error) {
    console.error("Save asset error:", error);
    showToast("Gagal menyimpan aset: " + error.message, "error");
  } finally {
    hideLoading();
  }
});

// ==========================================
// QR SCANNER (MODE CEPAT & MODE FORM BARU)
// ==========================================
function stopMainScanner() {
  if (mainScanner) {
    mainScanner
      .stop()
      .then(() => {
        mainScanner.clear();
        mainScanner = null;
        $("btn-start-scan").classList.remove("hidden");
        $("btn-stop-scan").classList.add("hidden");
        $("qr-reader").innerHTML = "Kamera belum aktif";
      })
      .catch(() => {});
  }
}

function stopFormScanner() {
  if (formScanner) {
    formScanner
      .stop()
      .then(() => {
        formScanner.clear();
        formScanner = null;
        $("form-qr-scanner-box").classList.add("hidden");
      })
      .catch(() => {});
  }
}

function stopAllScanners() {
  stopMainScanner();
  stopFormScanner();
}

$("btn-start-scan").addEventListener("click", () => {
  $("qr-reader").innerHTML = "";
  mainScanner = new Html5Qrcode("qr-reader");

  mainScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        stopMainScanner();
        handleLookupQR(decodedText.trim().toUpperCase());
      },
      () => {},
    )
    .then(() => {
      $("btn-start-scan").classList.add("hidden");
      $("btn-stop-scan").classList.remove("hidden");
    })
    .catch((err) => {
      showToast("Tidak dapat mengakses kamera: " + err, "error");
    });
});

$("btn-stop-scan").addEventListener("click", stopMainScanner);

$("btn-manual-lookup").addEventListener("click", () => {
  const code = $("manual-qr-lookup").value.trim().toUpperCase();
  if (!code) {
    showToast("Masukkan Kode QR terlebih dahulu.", "warning");
    return;
  }
  handleLookupQR(code);
});

function handleLookupQR(code) {
  const found = allAssets.find((a) => a.kode_qr.toUpperCase() === code);
  if (found) {
    openDetailModal(found);
  } else {
    showToast(`Aset dengan kode "${code}" tidak ditemukan.`, "error");
  }
}

$("btn-mode-manual").addEventListener("click", () => {
  stopFormScanner();
  $("input-kode-qr").value = "";
  $("input-kode-qr").focus();
});

$("btn-mode-scan-qr").addEventListener("click", () => {
  $("form-qr-scanner-box").classList.remove("hidden");
  formScanner = new Html5Qrcode("form-qr-reader");

  formScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 200, height: 200 } },
      (decodedText) => {
        const scannedCode = decodedText.trim().toUpperCase();
        stopFormScanner();

        const existing = allAssets.find(
          (a) => a.kode_qr.toUpperCase() === scannedCode,
        );
        if (existing) {
          showToast(
            `QR "${scannedCode}" sudah terdaftar! Membuka detail aset...`,
            "warning",
          );
          openDetailModal(existing);
        } else {
          $("input-kode-qr").value = scannedCode;
          showToast(`QR baru terbaca: ${scannedCode}. Silakan lengkapi form.`);
        }
      },
      () => {},
    )
    .catch((err) => {
      showToast("Gagal membuka kamera: " + err, "error");
    });
});

$("btn-close-form-scanner").addEventListener("click", stopFormScanner);

// ==========================================
// MODAL DETAIL ASET, STOCK OPNAME, EDIT & DELETE
// ==========================================
async function openDetailModal(aset) {
  selectedAsset = aset;

  $("detail-kode-qr").textContent = aset.kode_qr;
  $("detail-nama-aset").textContent = aset.nama_aset;
  $("detail-kategori").textContent = aset.kategori || "-";
  $("detail-merk").textContent = aset.merk_tipe || "-";
  $("detail-lokasi").textContent = aset.lokasi || "-";
  $("detail-pic").textContent = aset.pic_penanggung_jawab || "-";
  $("detail-kondisi").textContent = aset.kondisi || "-";
  $("detail-audit").textContent = formatTimestamp(aset.terakhir_audit);

  if (aset.url_foto) {
    $("detail-foto").src = aset.url_foto;
    $("detail-foto").classList.remove("hidden");
    $("detail-no-foto").classList.add("hidden");
  } else {
    $("detail-foto").classList.add("hidden");
    $("detail-no-foto").classList.remove("hidden");
  }

  if (aset.url_dokumen) {
    $("detail-link-dokumen").href = aset.url_dokumen;
    $("detail-link-dokumen").classList.remove("hidden");
  } else {
    $("detail-link-dokumen").classList.add("hidden");
  }

  const specs = [];
  if (aset.spesifikasi_detail)
    specs.push(
      `<div><span class="text-slate-400">Spesifikasi:</span> <strong>${escapeHTML(aset.spesifikasi_detail)}</strong></div>`,
    );
  if (aset.no_seri_atau_mesin)
    specs.push(
      `<div><span class="text-slate-400">No. Seri / Mesin:</span> <strong>${escapeHTML(aset.no_seri_atau_mesin)}</strong></div>`,
    );
  if (aset.platNomor || aset.plat_nomor)
    specs.push(
      `<div><span class="text-slate-400">Plat Nomor:</span> <strong>${escapeHTML(aset.plat_nomor)}</strong></div>`,
    );
  if (aset.tahun_pembuatan)
    specs.push(
      `<div><span class="text-slate-400">Tahun:</span> <strong>${escapeHTML(aset.tahun_pembuatan)}</strong></div>`,
    );
  if (aset.batas_garansi_atau_stnk)
    specs.push(
      `<div><span class="text-slate-400">Batas Garansi/STNK:</span> <strong>${escapeHTML(aset.batas_garansi_atau_stnk)}</strong></div>`,
    );
  if (aset.jadwal_maintenance)
    specs.push(
      `<div><span class="text-slate-400">Jadwal Maintenance:</span> <strong>${escapeHTML(aset.jadwal_maintenance)}</strong></div>`,
    );
  if (currentUser.role === "Admin" && aset.harga_perolehan) {
    specs.push(
      `<div><span class="text-slate-400">Harga Perolehan:</span> <strong>${formatRupiah(aset.harga_perolehan)}</strong></div>`,
    );
  }
  if (aset.catatan)
    specs.push(
      `<div><span class="text-slate-400">Catatan:</span> ${escapeHTML(aset.catatan)}</div>`,
    );

  $("detail-extra-specs").innerHTML =
    specs.length > 0
      ? specs.join("")
      : '<p class="text-slate-400">Tidak ada rincian tambahan.</p>';

  $("opname-kondisi").value = aset.kondisi || "Baik";
  $("opname-lokasi").value = aset.lokasi || "";
  $("opname-catatan").value = "";

  $("modal-detail").classList.remove("hidden");
  lucide.createIcons();

  await loadAssetLogs(aset.id);
}

async function loadAssetLogs(asetId) {
  const listEl = $("detail-log-list");
  listEl.innerHTML = '<p class="text-slate-400">Memuat riwayat...</p>';

  try {
    const { data, error } = await supabase
      .from("log_aktivitas")
      .select("*")
      .eq("id_aset", asetId)
      .order("tanggal", { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!data || data.length === 0) {
      listEl.innerHTML =
        '<p class="text-slate-400">Belum ada riwayat aktivitas.</p>';
      return;
    }

    listEl.innerHTML = data
      .map(
        (l) => `
        <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-700">
          <div class="flex justify-between font-semibold">
            <span>${escapeHTML(l.jenis_aktivitas)} (${escapeHTML(l.kondisi)})</span>
            <span class="text-slate-400 font-normal">${formatTimestamp(l.tanggal)}</span>
          </div>
          <p class="text-slate-500 dark:text-slate-300 mt-0.5">${escapeHTML(l.keterangan || "-")}</p>
          <p class="text-[11px] text-slate-400 mt-0.5">Oleh: ${escapeHTML(l.petugas_nama)} • Lokasi: ${escapeHTML(l.lokasi_baru)}</p>
        </div>
      `,
      )
      .join("");
  } catch (err) {
    listEl.innerHTML =
      '<p class="text-slate-400">Gagal memuat riwayat aktivitas.</p>';
  }
}

$("btn-close-detail").addEventListener("click", () => {
  $("modal-detail").classList.add("hidden");
});

// Submit Stock Opname / Audit (Admin & Staff)
$("opname-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedAsset) return;

  const kondisiBaru = $("opname-kondisi").value;
  const lokasiBaru = $("opname-lokasi").value.trim();
  const catatanAudit =
    $("opname-catatan").value.trim() || "Pengecekan fisik rutin";
  const nowISO = new Date().toISOString();

  showLoading("Menyimpan hasil Stock Opname...");

  try {
    const { error: updErr } = await supabase
      .from("master_aset")
      .update({
        kondisi: kondisiBaru,
        lokasi: lokasiBaru,
        catatan: catatanAudit,
        terakhir_audit: nowISO,
        updated_at: nowISO,
      })
      .eq("id", selectedAsset.id);

    if (updErr) throw updErr;

    const { error: logErr } = await supabase.from("log_aktivitas").insert({
      id_aset: selectedAsset.id,
      kode_qr: selectedAsset.kode_qr,
      nama_aset: selectedAsset.nama_aset,
      jenis_aktivitas: "Stock Opname",
      lokasi_lama: selectedAsset.lokasi || "-",
      lokasi_baru: lokasiBaru,
      pic_lama: selectedAsset.pic_penanggung_jawab || "-",
      pic_baru: selectedAsset.pic_penanggung_jawab || "-",
      kondisi: kondisiBaru,
      keterangan: catatanAudit,
      petugas_nama: `${currentUser.nama_lengkap} (${currentUser.username_id})`,
      petugas_uid: currentUser.uid,
    });

    if (logErr) throw logErr;

    showToast("Stock Opname berhasil dicatat!");
    $("modal-detail").classList.add("hidden");
    await loadAllData();
  } catch (error) {
    console.error("Opname error:", error);
    showToast("Gagal menyimpan Stock Opname: " + error.message, "error");
  } finally {
    hideLoading();
  }
});

// Edit Aset (Admin Only)
$("btn-edit-aset").addEventListener("click", () => {
  if (currentUser?.role !== "Admin" || !selectedAsset) return;

  $("modal-detail").classList.add("hidden");
  switchView("form");

  $("form-aset-title").textContent = "Edit Data Aset";
  $("add-mode-selector").classList.add("hidden");
  $("aset-doc-id").value = selectedAsset.id;

  $("input-kode-qr").value = selectedAsset.kode_qr;
  $("input-kode-qr").readOnly = true;
  $("input-kategori").value = selectedAsset.kategori || "Peralatan IT";
  updateDynamicFormFields();

  $("input-nama-aset").value = selectedAsset.nama_aset || "";
  $("input-merk-tipe").value = selectedAsset.merk_tipe || "";
  $("input-spesifikasi").value = selectedAsset.spesifikasi_detail || "";
  $("input-no-seri").value = selectedAsset.no_seri_atau_mesin || "";
  $("input-plat-nomor").value = selectedAsset.plat_nomor || "";
  $("input-tahun").value = selectedAsset.tahun_pembuatan || "";
  $("input-tanggal-beli").value = selectedAsset.tanggal_beli || "";
  $("input-harga").value = selectedAsset.harga_perolehan || "";
  $("input-garansi-stnk").value = selectedAsset.batas_garansi_atau_stnk || "";
  $("input-maintenance").value = selectedAsset.jadwal_maintenance || "";
  $("input-lokasi").value = selectedAsset.lokasi || "";
  $("input-pic").value = selectedAsset.pic_penanggung_jawab || "";
  $("input-kondisi").value = selectedAsset.kondisi || "Baik";
  $("input-status").value = selectedAsset.status || "Aktif";
  $("input-catatan").value = selectedAsset.catatan || "";

  if (selectedAsset.url_foto) {
    $("preview-foto").src = selectedAsset.url_foto;
    $("preview-foto").classList.remove("hidden");
  } else {
    $("preview-foto").classList.add("hidden");
  }

  if (selectedAsset.url_dokumen) {
    $("existing-dokumen-info").textContent =
      "Dokumen tersimpan (unggah baru untuk mengganti)";
    $("existing-dokumen-info").classList.remove("hidden");
  } else {
    $("existing-dokumen-info").classList.add("hidden");
  }
});

// Hapus Aset (Admin Only)
$("btn-delete-aset").addEventListener("click", async () => {
  if (currentUser?.role !== "Admin" || !selectedAsset) return;

  const yakin = confirm(
    `Hapus permanen aset "${selectedAsset.nama_aset}" (${selectedAsset.kode_qr})?`,
  );
  if (!yakin) return;

  showLoading("Menghapus aset...");
  try {
    const { error } = await supabase
      .from("master_aset")
      .delete()
      .eq("id", selectedAsset.id);

    if (error) throw error;

    showToast("Aset berhasil dihapus.");
    $("modal-detail").classList.add("hidden");
    await loadAllData();
  } catch (error) {
    showToast("Gagal menghapus aset: " + error.message, "error");
  } finally {
    hideLoading();
  }
});

// ==========================================
// QR CODE GENERATOR, DOWNLOAD & PRINT LABEL
// ==========================================
function openQRModal(kodeQR, namaAset) {
  const canvasBox = $("qrcode-canvas");
  canvasBox.innerHTML = "";

  new QRCode(canvasBox, {
    text: kodeQR,
    width: 180,
    height: 180,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });

  $("qr-label-code").textContent = kodeQR;
  $("qr-label-name").textContent = namaAset;
  $("modal-qr").classList.remove("hidden");
}

$("btn-reprint-qr").addEventListener("click", () => {
  if (selectedAsset) {
    openQRModal(selectedAsset.kode_qr, selectedAsset.nama_aset);
  }
});

$("btn-close-qr").addEventListener("click", () => {
  $("modal-qr").classList.add("hidden");
});

$("btn-download-qr").addEventListener("click", () => {
  const img = $("qrcode-canvas").querySelector("img");
  const canvas = $("qrcode-canvas").querySelector("canvas");
  const dataUrl = img ? img.src : canvas ? canvas.toDataURL("image/png") : null;

  if (!dataUrl) {
    showToast("QR Code belum siap diunduh.", "error");
    return;
  }

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${$("qr-label-code").textContent}.png`;
  link.click();
});

$("btn-print-qr").addEventListener("click", () => {
  window.print();
});

// ==========================================
// EXPORT CSV (ADMIN ONLY)
// ==========================================
$("btn-export-csv")?.addEventListener("click", () => {
  if (currentUser?.role !== "Admin") return;

  const data = getFilteredAssets();
  if (data.length === 0) {
    showToast("Tidak ada data untuk di-export.", "warning");
    return;
  }

  const headers = [
    "Kode QR",
    "Nama Aset",
    "Kategori",
    "Merk/Tipe",
    "Spesifikasi",
    "No Seri/Mesin",
    "Plat Nomor",
    "Tahun",
    "Tanggal Beli",
    "Harga Perolehan",
    "Batas Garansi/STNK",
    "Jadwal Maintenance",
    "Lokasi",
    "PIC",
    "Kondisi",
    "Status",
    "Catatan",
  ];

  const rows = data.map((a) => [
    a.kode_qr,
    a.nama_aset,
    a.kategori,
    a.merk_tipe,
    a.spesifikasi_detail,
    a.no_seri_atau_mesin,
    a.plat_nomor,
    a.tahun_pembuatan,
    a.tanggal_beli,
    a.harga_perolehan,
    a.batas_garansi_atau_stnk,
    a.jadwal_maintenance,
    a.lokasi,
    a.pic_penanggung_jawab,
    a.kondisi,
    a.status,
    a.catatan,
  ]);

  const csvContent =
    "data:text/csv;charset=utf-8," +
    [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `Laporan_Aset_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// ==========================================
// INIT APPLICATION
// ==========================================
initThemeToggle();
lucide.createIcons();
