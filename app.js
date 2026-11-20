// app.js
import { auth, db, storage } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

// ==========================================
// GLOBAL STATE
// ==========================================
let currentUser = null; // { uid, email, namaLengkap, role }
let allAssets = []; // Cache daftar aset dari Firestore
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

// Sanitasi teks mencegah XSS saat menyusun HTML
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
  const date = ts.toDate ? ts.toDate() : new Date(ts);
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

// Kompresi gambar di sisi browser sebelum upload ke Firebase Storage
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
// AUTHENTICATION & RBAC
// ==========================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    stopAllScanners();
    $("app-section").classList.add("hidden");
    $("login-section").classList.remove("hidden");
    return;
  }

  showLoading("Memverifikasi akun...");
  try {
    const userDocRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userDocRef);

    if (!userSnap.exists()) {
      await signOut(auth);
      showToast("Profil user tidak ditemukan di database.", "error");
      return;
    }

    const userData = userSnap.data();
    if (userData.statusAktif !== true) {
      await signOut(auth);
      showToast("Akun Anda telah dinonaktifkan oleh Admin.", "error");
      return;
    }

    currentUser = {
      uid: user.uid,
      email: user.email,
      namaLengkap: userData.namaLengkap || user.email,
      role: userData.role || "Staff",
    };

    setupUIByRole();
    $("login-section").classList.add("hidden");
    $("app-section").classList.remove("hidden");

    await loadAllData();

    // Routing awal sesuai role
    if (currentUser.role === "Admin") {
      switchView("dashboard");
    } else {
      switchView("scan");
    }
  } catch (error) {
    console.error("Auth error:", error);
    showToast("Gagal memuat sesi pengguna: " + error.message, "error");
  } finally {
    hideLoading();
  }
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const errBox = $("login-error");

  errBox.classList.add("hidden");
  showLoading("Sedang masuk...");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    $("login-form").reset();
  } catch (error) {
    errBox.textContent = "Email atau password salah, atau jaringan bermasalah.";
    errBox.classList.remove("hidden");
  } finally {
    hideLoading();
  }
});

document.querySelectorAll(".btn-logout").forEach((btn) => {
  btn.addEventListener("click", async () => {
    stopAllScanners();
    await signOut(auth);
    showToast("Anda telah keluar dari sistem.");
  });
});

function setupUIByRole() {
  const isAdmin = currentUser.role === "Admin";

  // Update info user di Desktop & Mobile header
  $("desktop-user-name").textContent = currentUser.namaLengkap;
  $("desktop-user-role").textContent = currentUser.role;
  $("mobile-user-info").textContent =
    `${currentUser.namaLengkap} (${currentUser.role})`;

  // Tampilkan/sembunyikan elemen khusus Admin
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
  // Cegah Staff mengakses view khusus Admin
  if (
    currentUser?.role !== "Admin" &&
    (viewName === "dashboard" || viewName === "form")
  ) {
    viewName = "scan";
  }

  // Matikan kamera jika pindah dari halaman scan/form
  if (viewName !== "scan") stopMainScanner();
  if (viewName !== "form") stopFormScanner();

  document
    .querySelectorAll(".app-view")
    .forEach((v) => v.classList.add("hidden"));
  const targetView = $(`view-${viewName}`);
  if (targetView) targetView.classList.remove("hidden");

  // Update status aktif tombol navigasi
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
    if (target === "form") {
      resetAsetForm();
    }
    switchView(target);
  });
});

// ==========================================
// LOAD DATA DARI FIRESTORE
// ==========================================
async function loadAllData() {
  showLoading("Memuat data aset...");
  try {
    const q = query(
      collection(db, "master_aset"),
      orderBy("updatedAt", "desc"),
    );
    const snapshot = await getDocs(q);

    allAssets = [];
    snapshot.forEach((docSnap) => {
      allAssets.push({ id: docSnap.id, ...docSnap.data() });
    });

    populateLocationFilters();
    renderAssetList();

    if (currentUser.role === "Admin") {
      updateDashboardKPI();
      await loadRecentLogs();
    }
  } catch (error) {
    console.error("Error loading assets:", error);
    showToast("Gagal memuat daftar aset.", "error");
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
    totalNilai += Number(aset.hargaPerolehan) || 0;
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
    const q = query(
      collection(db, "log_aktivitas"),
      orderBy("tanggal", "desc"),
      limit(8),
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML =
        '<p class="text-slate-400 py-4 text-center">Belum ada aktivitas tercatat.</p>';
      return;
    }

    let html = "";
    snap.forEach((docSnap) => {
      const log = docSnap.data();
      html += `
        <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <span class="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">${escapeHTML(log.kodeQR)}</span>
            <span class="font-medium ml-1.5">${escapeHTML(log.namaAset)}</span>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span class="font-semibold">${escapeHTML(log.jenisAktivitas)}</span> — ${escapeHTML(log.keterangan || "-")}
            </p>
          </div>
          <div class="text-left sm:text-right text-xs text-slate-400 shrink-0">
            <p class="font-medium text-slate-600 dark:text-slate-300">${escapeHTML(log.petugasNama)}</p>
            <p>${formatTimestamp(log.tanggal)}</p>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
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
      (item.namaAset && item.namaAset.toLowerCase().includes(search)) ||
      (item.kodeQR && item.kodeQR.toLowerCase().includes(search)) ||
      (item.picPenanggungJawab &&
        item.picPenanggungJawab.toLowerCase().includes(search)) ||
      (item.platNomor && item.platNomor.toLowerCase().includes(search));

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
    const subInfo = aset.platNomor
      ? ` • ${escapeHTML(aset.platNomor)}`
      : aset.merkTipe
        ? ` • ${escapeHTML(aset.merkTipe)}`
        : "";

    // Desktop Row
    tableHtml += `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
        <td class="py-3 px-4 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">${escapeHTML(aset.kodeQR)}</td>
        <td class="py-3 px-4">
          <div class="font-semibold">${escapeHTML(aset.namaAset)}</div>
          <div class="text-xs text-slate-400">${escapeHTML(aset.merkTipe || "-")} ${aset.platNomor ? `(${escapeHTML(aset.platNomor)})` : ""}</div>
        </td>
        <td class="py-3 px-4 text-xs">${escapeHTML(aset.kategori)}</td>
        <td class="py-3 px-4">
          <div class="text-xs font-medium">${escapeHTML(aset.lokasi)}</div>
          <div class="text-[11px] text-slate-400">PIC: ${escapeHTML(aset.picPenanggungJawab)}</div>
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

    // Mobile Card
    mobileHtml += `
      <div data-id="${aset.id}" class="btn-open-detail bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm active:scale-[0.99] transition cursor-pointer">
        <div class="flex justify-between items-start gap-2 mb-1.5">
          <span class="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">${escapeHTML(aset.kodeQR)}</span>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${badgeClass}">${escapeHTML(aset.kondisi)}</span>
        </div>
        <h4 class="font-bold text-base leading-snug">${escapeHTML(aset.namaAset)}</h4>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">${escapeHTML(aset.kategori)}${subInfo}</p>
        <div class="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700 flex justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>📍 ${escapeHTML(aset.lokasi)}</span>
          <span>👤 ${escapeHTML(aset.picPenanggungJawab)}</span>
        </div>
      </div>
    `;
  });

  tbody.innerHTML = tableHtml;
  mobileList.innerHTML = mobileHtml;

  // Bind event klik detail
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

  // Reset visibilitas default
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
    const url = URL.createObjectURL(file);
    $("preview-foto").src = url;
    $("preview-foto").classList.remove("hidden");
  }
});

$("aset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentUser?.role !== "Admin") return;

  const docId = $("aset-doc-id").value;
  const isEdit = Boolean(docId);

  let kodeQR = $("input-kode-qr").value.trim().toUpperCase();
  if (!kodeQR) {
    kodeQR = generateAutoQR();
  }

  // Cek duplikasi Kode QR saat tambah baru
  if (!isEdit) {
    const duplicate = allAssets.find((a) => a.kodeQR.toUpperCase() === kodeQR);
    if (duplicate) {
      showToast(
        `Kode QR ${kodeQR} sudah digunakan oleh aset "${duplicate.namaAset}"!`,
        "error",
      );
      return;
    }
  }

  showLoading(
    isEdit ? "Menyimpan perubahan aset..." : "Menyimpan aset baru...",
  );

  try {
    let urlFoto = isEdit ? selectedAsset?.urlFoto || "" : "";
    let urlDokumen = isEdit ? selectedAsset?.urlDokumen || "" : "";

    // 1. Kompres & Upload Foto jika ada file baru dipilih
    const fotoFile = $("input-foto").files[0];
    if (fotoFile) {
      showLoading("Mengompres & mengunggah foto...");
      const compressedBlob = await compressImage(fotoFile, 1280, 0.7);
      const fotoRef = ref(storage, `aset_foto/${kodeQR}_${Date.now()}.jpg`);
      await uploadBytes(fotoRef, compressedBlob, { contentType: "image/jpeg" });
      urlFoto = await getDownloadURL(fotoRef);
    }

    // 2. Upload Dokumen jika ada file baru dipilih
    const dokFile = $("input-dokumen").files[0];
    if (dokFile) {
      showLoading("Mengunggah dokumen aset...");
      const safeName = dokFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dokRef = ref(
        storage,
        `aset_dokumen/${kodeQR}_${Date.now()}_${safeName}`,
      );
      await uploadBytes(dokRef, dokFile);
      urlDokumen = await getDownloadURL(dokRef);
    }

    const payload = {
      kodeQR,
      namaAset: $("input-nama-aset").value.trim(),
      kategori: $("input-kategori").value,
      merkTipe: $("input-merk-tipe").value.trim(),
      spesifikasiDetail: $("input-spesifikasi").value.trim(),
      noSeriAtauMesin: $("input-no-seri").value.trim(),
      platNomor: $("input-plat-nomor").value.trim().toUpperCase(),
      tahunPembuatan: $("input-tahun").value.trim(),
      tanggalBeli: $("input-tanggal-beli").value,
      hargaPerolehan: Number($("input-harga").value) || 0,
      batasGaransiAtauSTNK: $("input-garansi-stnk").value,
      jadwalMaintenance: $("input-maintenance").value,
      lokasi: $("input-lokasi").value.trim(),
      picPenanggungJawab: $("input-pic").value.trim(),
      kondisi: $("input-kondisi").value,
      status: $("input-status").value,
      urlFoto,
      urlDokumen,
      catatan: $("input-catatan").value.trim(),
      updatedAt: serverTimestamp(),
    };

    if (isEdit) {
      await updateDoc(doc(db, "master_aset", docId), payload);

      await addDoc(collection(db, "log_aktivitas"), {
        idAset: docId,
        kodeQR: payload.kodeQR,
        namaAset: payload.namaAset,
        tanggal: serverTimestamp(),
        jenisAktivitas: "Update Data",
        lokasiLama: selectedAsset?.lokasi || "-",
        lokasiBaru: payload.lokasi,
        picLama: selectedAsset?.picPenanggungJawab || "-",
        picBaru: payload.picPenanggungJawab,
        kondisi: payload.kondisi,
        keterangan: "Pembaruan data master aset oleh Admin",
        petugasNama: currentUser.namaLengkap,
        petugasUid: currentUser.uid,
      });

      showToast("Data aset berhasil diperbarui!");
      await loadAllData();
      switchView("aset");
    } else {
      payload.createdAt = serverTimestamp();
      payload.terakhirAudit = serverTimestamp();

      const newDocRef = await addDoc(collection(db, "master_aset"), payload);

      await addDoc(collection(db, "log_aktivitas"), {
        idAset: newDocRef.id,
        kodeQR: payload.kodeQR,
        namaAset: payload.namaAset,
        tanggal: serverTimestamp(),
        jenisAktivitas: "Aset Baru",
        lokasiLama: "-",
        lokasiBaru: payload.lokasi,
        picLama: "-",
        picBaru: payload.picPenanggungJawab,
        kondisi: payload.kondisi,
        keterangan: "Registrasi aset baru",
        petugasNama: currentUser.namaLengkap,
        petugasUid: currentUser.uid,
      });

      showToast("Aset baru berhasil ditambahkan!");
      await loadAllData();
      switchView("aset");

      // Tampilkan modal QR Code otomatis setelah simpan baru
      openQRModal(payload.kodeQR, payload.namaAset);
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

// Scanner 1: Halaman Scan Cepat
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
  const found = allAssets.find((a) => a.kodeQR.toUpperCase() === code);
  if (found) {
    openDetailModal(found);
  } else {
    showToast(`Aset dengan kode "${code}" tidak ditemukan.`, "error");
  }
}

// Scanner 2: Saat Tambah Aset (Scan Stiker QR yang sudah ada)
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
          (a) => a.kodeQR.toUpperCase() === scannedCode,
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

  $("detail-kode-qr").textContent = aset.kodeQR;
  $("detail-nama-aset").textContent = aset.namaAset;
  $("detail-kategori").textContent = aset.kategori || "-";
  $("detail-merk").textContent = aset.merkTipe || "-";
  $("detail-lokasi").textContent = aset.lokasi || "-";
  $("detail-pic").textContent = aset.picPenanggungJawab || "-";
  $("detail-kondisi").textContent = aset.kondisi || "-";
  $("detail-audit").textContent = formatTimestamp(aset.terakhirAudit);

  // Foto
  if (aset.urlFoto) {
    $("detail-foto").src = aset.urlFoto;
    $("detail-foto").classList.remove("hidden");
    $("detail-no-foto").classList.add("hidden");
  } else {
    $("detail-foto").classList.add("hidden");
    $("detail-no-foto").classList.remove("hidden");
  }

  // Dokumen
  if (aset.urlDokumen) {
    $("detail-link-dokumen").href = aset.urlDokumen;
    $("detail-link-dokumen").classList.remove("hidden");
  } else {
    $("detail-link-dokumen").classList.add("hidden");
  }

  // Spesifikasi Tambahan Dinamis
  const specs = [];
  if (aset.spesifikasiDetail)
    specs.push(
      `<div><span class="text-slate-400">Spesifikasi:</span> <strong>${escapeHTML(aset.spesifikasiDetail)}</strong></div>`,
    );
  if (aset.noSeriAtauMesin)
    specs.push(
      `<div><span class="text-slate-400">No. Seri / Mesin:</span> <strong>${escapeHTML(aset.noSeriAtauMesin)}</strong></div>`,
    );
  if (aset.platNomor)
    specs.push(
      `<div><span class="text-slate-400">Plat Nomor:</span> <strong>${escapeHTML(aset.platNomor)}</strong></div>`,
    );
  if (aset.tahunPembuatan)
    specs.push(
      `<div><span class="text-slate-400">Tahun:</span> <strong>${escapeHTML(aset.tahunPembuatan)}</strong></div>`,
    );
  if (aset.batasGaransiAtauSTNK)
    specs.push(
      `<div><span class="text-slate-400">Batas Garansi/STNK:</span> <strong>${escapeHTML(aset.batasGaransiAtauSTNK)}</strong></div>`,
    );
  if (aset.jadwalMaintenance)
    specs.push(
      `<div><span class="text-slate-400">Jadwal Maintenance:</span> <strong>${escapeHTML(aset.jadwalMaintenance)}</strong></div>`,
    );
  if (currentUser.role === "Admin" && aset.hargaPerolehan) {
    specs.push(
      `<div><span class="text-slate-400">Harga Perolehan:</span> <strong>${formatRupiah(aset.hargaPerolehan)}</strong></div>`,
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

  // Pre-fill form Stock Opname
  $("opname-kondisi").value = aset.kondisi || "Baik";
  $("opname-lokasi").value = aset.lokasi || "";
  $("opname-catatan").value = "";

  $("modal-detail").classList.remove("hidden");
  lucide.createIcons();

  // Muat riwayat log aset ini
  await loadAssetLogs(aset.id);
}

async function loadAssetLogs(asetId) {
  const listEl = $("detail-log-list");
  listEl.innerHTML = '<p class="text-slate-400">Memuat riwayat...</p>';

  try {
    const q = query(
      collection(db, "log_aktivitas"),
      where("idAset", "==", asetId),
      orderBy("tanggal", "desc"),
      limit(10),
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      listEl.innerHTML =
        '<p class="text-slate-400">Belum ada riwayat aktivitas.</p>';
      return;
    }

    let html = "";
    snap.forEach((d) => {
      const l = d.data();
      html += `
        <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-700">
          <div class="flex justify-between font-semibold">
            <span>${escapeHTML(l.jenisAktivitas)} (${escapeHTML(l.kondisi)})</span>
            <span class="text-slate-400 font-normal">${formatTimestamp(l.tanggal)}</span>
          </div>
          <p class="text-slate-500 dark:text-slate-300 mt-0.5">${escapeHTML(l.keterangan || "-")}</p>
          <p class="text-[11px] text-slate-400 mt-0.5">Oleh: ${escapeHTML(l.petugasNama)} • Lokasi: ${escapeHTML(l.lokasiBaru)}</p>
        </div>
      `;
    });
    listEl.innerHTML = html;
  } catch (err) {
    // Fallback jika composite index Firestore belum dibuat
    listEl.innerHTML =
      '<p class="text-slate-400">Riwayat belum tersedia (memerlukan index Firestore).</p>';
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

  showLoading("Menyimpan hasil Stock Opname...");

  try {
    const asetRef = doc(db, "master_aset", selectedAsset.id);
    await updateDoc(asetRef, {
      kondisi: kondisiBaru,
      lokasi: lokasiBaru,
      catatan: catatanAudit,
      terakhirAudit: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "log_aktivitas"), {
      idAset: selectedAsset.id,
      kodeQR: selectedAsset.kodeQR,
      namaAset: selectedAsset.namaAset,
      tanggal: serverTimestamp(),
      jenisAktivitas: "Stock Opname",
      lokasiLama: selectedAsset.lokasi || "-",
      lokasiBaru: lokasiBaru,
      picLama: selectedAsset.picPenanggungJawab || "-",
      picBaru: selectedAsset.picPenanggungJawab || "-",
      kondisi: kondisiBaru,
      keterangan: catatanAudit,
      petugasNama: currentUser.namaLengkap,
      petugasUid: currentUser.uid,
    });

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

  $("input-kode-qr").value = selectedAsset.kodeQR;
  $("input-kode-qr").readOnly = true;
  $("input-kategori").value = selectedAsset.kategori || "Peralatan IT";
  updateDynamicFormFields();

  $("input-nama-aset").value = selectedAsset.namaAset || "";
  $("input-merk-tipe").value = selectedAsset.merkTipe || "";
  $("input-spesifikasi").value = selectedAsset.spesifikasiDetail || "";
  $("input-no-seri").value = selectedAsset.noSeriAtauMesin || "";
  $("input-plat-nomor").value = selectedAsset.platNomor || "";
  $("input-tahun").value = selectedAsset.tahunPembuatan || "";
  $("input-tanggal-beli").value = selectedAsset.tanggalBeli || "";
  $("input-harga").value = selectedAsset.hargaPerolehan || "";
  $("input-garansi-stnk").value = selectedAsset.batasGaransiAtauSTNK || "";
  $("input-maintenance").value = selectedAsset.jadwalMaintenance || "";
  $("input-lokasi").value = selectedAsset.lokasi || "";
  $("input-pic").value = selectedAsset.picPenanggungJawab || "";
  $("input-kondisi").value = selectedAsset.kondisi || "Baik";
  $("input-status").value = selectedAsset.status || "Aktif";
  $("input-catatan").value = selectedAsset.catatan || "";

  if (selectedAsset.urlFoto) {
    $("preview-foto").src = selectedAsset.urlFoto;
    $("preview-foto").classList.remove("hidden");
  } else {
    $("preview-foto").classList.add("hidden");
  }

  if (selectedAsset.urlDokumen) {
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
    `Hapus permanen aset "${selectedAsset.namaAset}" (${selectedAsset.kodeQR})?`,
  );
  if (!yakin) return;

  showLoading("Menghapus aset...");
  try {
    await deleteDoc(doc(db, "master_aset", selectedAsset.id));
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
    openQRModal(selectedAsset.kodeQR, selectedAsset.namaAset);
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
    a.kodeQR,
    a.namaAset,
    a.kategori,
    a.merkTipe,
    a.spesifikasiDetail,
    a.noSeriAtauMesin,
    a.platNomor,
    a.tahunPembuatan,
    a.tanggalBeli,
    a.hargaPerolehan,
    a.batasGaransiAtauSTNK,
    a.jadwalMaintenance,
    a.lokasi,
    a.picPenanggungJawab,
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
