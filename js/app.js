/* ==========================================================================
   1. GLOBAL STATE & DATA STORES
   ========================================================================== */

// Counter ID Transaksi Otomatis
let transactionCounters = {
    INB: 1,
    OUB: 1,
    FGI: 1,
    FGO: 1,
    PLE: 1
};

// Dashboard Running Totals
let dashboardData = {
    inboundMaterial: 0,
    outboundMaterial: 0,
    fgOutboundUnits: 0,
    antreanPicking: 0
};

// History Data untuk Sparkline Graphs
let historyData = {
    inbound: [0, 0, 0, 0, 0, 0],
    outbound: [0, 0, 0, 0, 0, 0],
    fgInbound: [0, 0, 0, 0, 0, 0],
    fgOutbound: [0, 0, 0, 0, 0, 0],
    picking: [0, 0, 0, 0, 0, 0],
    pallet: [0, 0, 0, 0, 0, 0]
};

// Data Stok Engine (Pcs)
let engineStock = {
    ZQD: { units: 0 },
    ZQB: { units: 0 }
};

// Data Stok Pallet (Kosong, Terpakai, NG)
let palletStock = {
    ZQD: { kosong: 0, terpakai: 0, ng: 0 },
    ZQB: { kosong: 0, terpakai: 0, ng: 0 }
};

// Tracking Pallet Aktif (Inbound FIFO)
let activePalletState = {
    ZQD: { lastDate: '', currentPalletQty: 0 },
    ZQB: { lastDate: '', currentPalletQty: 0 }
};

// Master Material Counter & Local Inventory Store
let noZqd = 1;
let noZqb = 1;
window.inventoryStok = window.inventoryStok || [];


/* ==========================================================================
   2. HELPER & UTILITY FUNCTIONS
   ========================================================================== */

// Generator ID Transaksi Otomatis (contoh: INB-001)
function generateTransactionID(prefix) {
    const count = transactionCounters[prefix] || 1;
    const formatted = String(count).padStart(3, '0');
    transactionCounters[prefix] = count + 1;
    return `${prefix}-${formatted}`;
}

// Format Tanggal (DD-MM-YY, HH:mm)
function getFormattedDateTime() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yy}, ${hh}:${min}`;
}

// Tanggal Sistem Simulasi (YYYY-MM-DD)
function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Kalkulasi Kebutuhan Pallet Inbound (FIFO & Lock Beda Hari)
function getInboundPalletRequirement(model, pcsInput) {
    const today = getTodayDateString();
    const state = activePalletState[model] || { lastDate: '', currentPalletQty: 0 };
    
    const effectiveActiveQty = (state.lastDate === today) ? state.currentPalletQty : 0;
    const spaceAvailable = effectiveActiveQty > 0 ? (4 - effectiveActiveQty) : 0;
    
    let palletsNeeded = 0;
    let newActiveQty = 0;
    
    if (pcsInput <= spaceAvailable) {
        palletsNeeded = 0;
        newActiveQty = effectiveActiveQty + pcsInput;
    } else {
        const remainingPcs = pcsInput - spaceAvailable;
        palletsNeeded = Math.ceil(remainingPcs / 4);
        const remainder = remainingPcs % 4;
        newActiveQty = remainder === 0 ? 4 : remainder;
    }

    return { palletsNeeded, newActiveQty };
}

// Toast Notification System (Single Source of Truth)
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) {
        console.log(`[TOAST - ${type.toUpperCase()}]: ${message}`);
        return;
    }

    const toast = document.createElement('div');
    
    let bgColor = 'bg-slate-800 text-white';
    let icon = 'ri-checkbox-circle-fill text-emerald-400';
    
    if (type === 'error') {
        bgColor = 'bg-rose-600 text-white';
        icon = 'ri-error-warning-fill text-white';
    } else if (type === 'warning') {
        bgColor = 'bg-amber-500 text-white';
        icon = 'ri-alert-fill text-white';
    } else if (type === 'info') {
        bgColor = 'bg-blue-600 text-white';
        icon = 'ri-information-fill text-white';
    }

    toast.className = `${bgColor} text-xs font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 pointer-events-auto transform transition-all duration-300 translate-y-2 opacity-0`;
    toast.innerHTML = `<i class="${icon} text-lg"></i> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


/* ==========================================================================
   3. BARCODE PARSER & SCANNER SYSTEM
   ========================================================================== */

/**
 * Memecah string barcode terstruktur (berpemisah ';') ke dalam objek JSON
 * Contoh: P:FZ70;V:100875;M:14313141-00/PCS;B:260803348Q;S:126080300353115;Q:24/6/51
 */
function parseWmsBarcode(rawText) {
    const result = {
        plant: '',       // P
        vendor: '',      // V
        sapCode: '',     // M (bersih dari /PCS)
        rawMaterial: '', // M
        batch: '',       // B
        lot: '',         // Lot
        packageId: '',   // S
        poNumber: '',    // PO
        qty: 0,          // Q (diambil angka pertama)
        date: '',        // D
        sn: '',          // SN
        expiredDate: '', // YX
        dnNumber: ''     // DN
    };

    if (!rawText || typeof rawText !== 'string') return result;

    const items = rawText.split(';');

    items.forEach(item => {
        const colonIdx = item.indexOf(':');
        if (colonIdx !== -1) {
            const key = item.substring(0, colonIdx).trim();
            const value = item.substring(colonIdx + 1).trim();

            result[key] = value; 

            switch (key) {
                case 'P': result.plant = value; break;
                case 'V': result.vendor = value; break;
                case 'M': 
                    result.rawMaterial = value;
                    result.sapCode = value.split('/')[0].trim(); 
                    break;
                case 'B': result.batch = value; break;
                case 'Lot': result.lot = value; break;
                case 'S': result.packageId = value; break;
                case 'PO': result.poNumber = value; break;
                case 'Q': 
                    const firstQty = value.split('/')[0];
                    result.qty = parseFloat(firstQty) || 0;
                    break;
                case 'D': result.date = value; break;
                case 'SN': result.sn = value; break;
                case 'YX': result.expiredDate = value; break;
                case 'DN': result.dnNumber = value; break;
            }
        }
    });

    return result;
}

// Eksekusi Scan Inbound
function processScanInbound(scannedValue) {
    if (!scannedValue) return;

    if (!scannedValue.includes(':')) {
        return; // Jika QR code sederhana / bukan QR WMS terstruktur
    }

    const data = parseWmsBarcode(scannedValue);

    // 1. Set Package ID (Key 'S')
    if (data.packageId || data['S']) {
        const el = document.getElementById('inboundPackageIdInput');
        if (el) el.value = data.packageId || data['S'];
    }

    // 2. Set Kode SAP (Key 'M')
    if (data.sapCode) {
        const el = document.getElementById('inboundSapInput');
        if (el) el.value = data.sapCode;
        fetchMaterialNameBySap(data.sapCode);
    }

    // 3. Set Batch (Key 'B')
    if (data.batch || data['B']) {
        const el = document.getElementById('inboundBatchInput');
        if (el) el.value = data.batch || data['B'];
    }

    // 4. Set Quantity (Key 'Q')
    if (data.qty) {
        const el = document.getElementById('inboundSparepartQtyInput');
        if (el) el.value = data.qty;
    }

    // 5. Pindahkan kursor otomatis ke Bin Location
    const binInput = document.getElementById('inboundBinInput');
    if (binInput) binInput.focus();

    showToast('Barcode Inbound berhasil diproses!', 'success');
}

// Eksekusi Scan Outbound
function processScanOutbound(scannedValue) {
    if (!scannedValue) return;

    const data = parseWmsBarcode(scannedValue);
    const packageId = data.packageId || data['S'] || scannedValue.trim();

    const el = document.getElementById('outboundPackageIdInput');
    if (el) el.value = packageId;

    lookupStokByPackageId(packageId);
}

// Google Apps Script Backend Fetch Material Name
function fetchMaterialNameBySap(sapCode) {
    const nameInput = document.getElementById('inboundMaterialNameInput');
    if (!nameInput) return;

    nameInput.value = 'Mencari...';

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler((materialName) => {
                nameInput.value = materialName || 'Material Tidak Ditemukan';
            })
            .getMaterialNameBySap(sapCode);
    } else {
        nameInput.value = 'Demo Material ' + sapCode;
    }
}

// Search stok saat Outbound Scan
function lookupStokByPackageId(packageId) {
    const itemInStok = window.inventoryStok.find(i => i.packageId === packageId);

    if (itemInStok) {
        if (document.getElementById('outboundSapInput')) document.getElementById('outboundSapInput').value = itemInStok.sap;
        if (document.getElementById('outboundMaterialNameInput')) document.getElementById('outboundMaterialNameInput').value = itemInStok.name;
        if (document.getElementById('outboundBatchInput')) document.getElementById('outboundBatchInput').value = itemInStok.batch;
        if (document.getElementById('outboundLocationInput')) document.getElementById('outboundLocationInput').value = itemInStok.location;
        if (document.getElementById('outboundSparepartQtyInput')) document.getElementById('outboundSparepartQtyInput').value = itemInStok.qty;
        
        showToast('Data paket ditemukan di stok!', 'info');
    } else {
        showToast('Package ID ' + packageId + ' tidak ditemukan di stok!', 'error');
    }
}


/* ==========================================================================
   4. UI NAVIGATION, CLOCK, & SPARKLINE
   ========================================================================== */

function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('id-ID');
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.innerText = timeString;
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const toggleIcon = document.getElementById('toggleIcon');
    
    if (!sidebar) return;
    sidebar.classList.toggle('-translate-x-full');
    if (overlay) overlay.classList.toggle('hidden');
    
    if (toggleIcon) {
        if (sidebar.classList.contains('-translate-x-full')) {
            toggleIcon.className = 'ri-menu-unfold-line text-2xl';
        } else {
            toggleIcon.className = 'ri-menu-fold-line text-2xl';
        }
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.submenu-content').forEach(menu => menu.classList.remove('open'));
    document.querySelectorAll('[id^="arrow-"]').forEach(arrow => arrow.classList.remove('rotate-180'));
}

function toggleDropdown(menuId, arrowId) {
    const targetMenu = document.getElementById(menuId);
    const targetArrow = document.getElementById(arrowId);
    const isOpen = targetMenu ? targetMenu.classList.contains('open') : false;

    closeAllDropdowns();

    if (!isOpen) {
        if (targetMenu) targetMenu.classList.add('open');
        if (targetArrow) targetArrow.classList.add('rotate-180');
    }
}

function navTo(pageId, btn) {
    document.querySelectorAll('.page-content').forEach(page => page.classList.add('hidden'));
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.remove('hidden');

    if (btn) {
        document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active-tab'));
        btn.classList.add('active-tab');
    }

    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }
}

// ============================================
// KONFIGURASI TABEL PER WIDGET
// Setiap widget punya header & sumber tabel sendiri
// ============================================
const WIDGET_TABLE_CONFIG = {
    'Material Inbound': {
        headers: ['Tanggal & Jam', 'Package ID (S)', 'Kode Material (SAP)', 'Nama Material', 'Batch', 'Qty', 'Lokasi'],
        sourceTbody: 'inboundTableBody'
    },
    'Material Outbound': {
        headers: ['Tanggal & Jam', 'Package ID (S)', 'Kode Material (SAP)', 'Nama Material', 'Batch', 'Qty Out'],
        sourceTbody: 'outboundTableBody'
    },
    'FG Inbound': {
        headers: ['Tanggal', 'ID Transaksi', 'Engine ID', 'Pallet ID', 'Qty', 'Pallet Terpakai'],
        sourceTbody: 'fgInboundTableBody'
    },
    'FG Outbound': {
        headers: ['Tanggal', 'ID Transaksi', 'Engine ID', 'Pallet ID', 'Qty', 'Pallet Kosong'],
        sourceTbody: 'fgOutboundTableBody'
    },
    'Antrean Picking': {
        headers: ['ID Order', 'Prioritas', 'Item', 'Lokasi Target', 'Status'],
        sourceTbody: null // belum ada sumber, tampilkan placeholder
    },
    'Kapasitas Pallet Engine': {
        headers: ['Tanggal', 'ID Transaksi', 'Pallet ID', 'Qty', 'Catatan', 'Status'],
        sourceTbody: 'palletRunningTableBody'
    }
};

function openWidgetRunning(title) {
    // Ambil config widget, atau fallback ke header generic
    const config = WIDGET_TABLE_CONFIG[title] || {
        headers: ['Tanggal', 'ID Transaksi', 'ID/Kode Item', 'Nama Description', 'Lokasi', 'Qty', 'Status Running'],
        sourceTbody: null
    };

    // 1. Set judul halaman
    const el = document.getElementById('widget-table-title');
    if (el) el.innerText = `Running Table - ${title}`;

    // 2. Render header kolom (dinamis)
    const thead = document.getElementById('widget-table-head');
    if (thead) {
        thead.innerHTML = '<tr>' + config.headers.map(h =>
            `<th class="p-3.5 font-semibold whitespace-nowrap">${h}</th>`
        ).join('') + '</tr>';
    }

    // 3. Clone data dari tabel sumber (kalau ada)
    const tbody = document.getElementById('widget-table-body');
    if (tbody) {
        const sourceTbody = config.sourceTbody ? document.getElementById(config.sourceTbody) : null;

        if (sourceTbody && sourceTbody.children.length > 0) {
            // Copy semua baris dari tbody sumber
            tbody.innerHTML = sourceTbody.innerHTML;
        } else {
            // Placeholder kalau belum ada data
            tbody.innerHTML = `<tr><td colspan="${config.headers.length}" class="p-6 text-center text-slate-400">Belum ada data untuk kategori ini.</td></tr>`;
        }
    }

    // 4. Navigate
    navTo('page-widget-table');
}

function switchRakTab(type) {
    const tabInput = document.getElementById('tab-rak-input');
    const tabOutput = document.getElementById('tab-rak-output');
    const btnInput = document.getElementById('btn-tab-rak-input');
    const btnOutput = document.getElementById('btn-tab-rak-output');

    if (type === 'input') {
        if (tabInput) tabInput.classList.remove('hidden');
        if (tabOutput) tabOutput.classList.add('hidden');
        if (btnInput) btnInput.className = "pb-2 text-sm font-semibold border-b-2 border-blue-600 text-blue-600 transition-all flex items-center gap-2";
        if (btnOutput) btnOutput.className = "pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800 transition-all flex items-center gap-2";
    } else {
        if (tabInput) tabInput.classList.add('hidden');
        if (tabOutput) tabOutput.classList.remove('hidden');
        if (btnOutput) btnOutput.className = "pb-2 text-sm font-semibold border-b-2 border-rose-600 text-rose-600 transition-all flex items-center gap-2";
        if (btnInput) btnInput.className = "pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800 transition-all flex items-center gap-2";
    }
}

function updateSparklinePath(svgId, dataArray) {
    const svgPath = document.getElementById(svgId);
    if (!svgPath) return;
    
    const max = Math.max(...dataArray, 10);
    const points = dataArray.map((val, idx) => {
        const x = idx * 20;
        const y = 28 - ((val / max) * 22);
        return `${x},${y.toFixed(1)}`;
    });
    
    svgPath.setAttribute('d', `M${points.join(' L')}`);
}

function addHistoryPoint(key, value, svgId) {
    if (!historyData[key]) return;
    historyData[key].push(value);
    if (historyData[key].length > 6) {
        historyData[key].shift();
    }
    updateSparklinePath(svgId, historyData[key]);
}


/* ==========================================================================
   5. FINISHGOODS (FG) TRANSACTIONS LOGIC
   ========================================================================== */

function syncFgModel() {
    const engineModel = document.getElementById('fgModelEngine').value;
    document.getElementById('fgModelPallet').value = engineModel;
    calculateFgQty();
}

function calculateFgQty() {
    const pcsInput = parseInt(document.getElementById('fgEngineQtyPcs').value) || 0;
    const palletModel = document.getElementById('fgModelPallet').value;
    const display = document.getElementById('fgTotalQtyDisplay');

    if (pcsInput <= 0) {
        if (display) display.innerText = '-';
        return;
    }

    const { palletsNeeded } = getInboundPalletRequirement(palletModel, pcsInput);
    if (display) display.innerText = `${palletsNeeded} Pallet`;
}

function syncFgOutModel() {
    const engineModel = document.getElementById('fgOutModelEngine').value;
    document.getElementById('fgOutModelPallet').value = engineModel;
    calculateFgOutQty();
}

function calculateFgOutQty() {
    const pcsInput = parseInt(document.getElementById('fgOutEngineQtyPcs').value) || 0;
    const display = document.getElementById('fgOutTotalQtyDisplay');

    if (pcsInput <= 0) {
        if (display) display.innerText = '-';
        return;
    }

    const palletsFreed = Math.ceil(pcsInput / 4);
    if (display) display.innerText = `${palletsFreed} Pallet`;
}

function submitFgInbound() {
    const engineModel = document.getElementById('fgModelEngine').value;
    const palletModel = document.getElementById('fgModelPallet').value;
    const pcsInput = parseInt(document.getElementById('fgEngineQtyPcs').value) || 0;

    if (pcsInput <= 0) {
        showToast('Masukkan jumlah Pcs yang valid!', 'warning');
        return;
    }

    const { palletsNeeded, newActiveQty } = getInboundPalletRequirement(palletModel, pcsInput);

    if (palletStock[palletModel].kosong < palletsNeeded) {
        showToast(`Stok pallet kosong (${palletModel}) tidak mencukupi! Diperlukan: ${palletsNeeded}`, 'error');
        return;
    }

    engineStock[engineModel].units += pcsInput;
    palletStock[palletModel].kosong -= palletsNeeded;
    palletStock[palletModel].terpakai += palletsNeeded;

    activePalletState[palletModel].lastDate = getTodayDateString();
    activePalletState[palletModel].currentPalletQty = newActiveQty;

    const txId = generateTransactionID('FGI');
    const dt = getFormattedDateTime();

    const fgTable = document.getElementById('fgInboundTableBody');
    if (fgTable) {
        const row = fgTable.insertRow(0);
        row.className = "hover:bg-slate-50";
        row.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${engineModel}</td>
            <td class="p-3.5 font-semibold">${palletModel}</td>
            <td class="p-3.5 font-semibold">${pcsInput} Pcs</td>
            <td class="p-3.5">${palletsNeeded} Pallet</td>
        `;
    }

    const engineTable = document.getElementById('engineRunningTableBody');
    if (engineTable) {
        const erow = engineTable.insertRow(0);
        erow.className = "hover:bg-slate-50";
        erow.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${engineModel}</td>
            <td class="p-3.5 font-semibold">${palletModel}</td>
            <td class="p-3.5 font-semibold text-black-600">${pcsInput} Pcs</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">Inbound</span></td>
        `;
    }

    const palletTable = document.getElementById('palletRunningTableBody');
    if (palletTable) {
        const prow = palletTable.insertRow(0);
        prow.className = "hover:bg-slate-50";
        prow.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${palletModel}</td>
            <td class="p-3.5 font-semibold text-black-600">${palletsNeeded} Pallet</td>
            <td class="p-3.5">Pallet Terpakai</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-orange-50 text-orange-600 rounded font-medium">FG Inbound</span></td>
        `;
    }

    updateEngineStockUI();
    updatePalletUI();
    document.getElementById('fgEngineQtyPcs').value = '';
    document.getElementById('fgTotalQtyDisplay').innerText = '-';
    showToast(`Inbound FG ${pcsInput} Pcs (${palletsNeeded} Pallet) Berhasil! ID: ${txId}`, 'success');
}

function submitFgOutbound() {
    const engineModel = document.getElementById('fgOutModelEngine').value;
    const palletModel = document.getElementById('fgOutModelPallet').value;
    const pcsInput = parseInt(document.getElementById('fgOutEngineQtyPcs').value) || 0;

    if (pcsInput <= 0) {
        showToast('Masukkan jumlah Pcs yang valid!', 'warning');
        return;
    }

    if (engineStock[engineModel].units < pcsInput) {
        showToast(`Stok Engine ${engineModel} tidak mencukupi! Stok saat ini: ${engineStock[engineModel].units} Pcs`, 'error');
        return;
    }

    const palletsFreed = Math.ceil(pcsInput / 4);

    engineStock[engineModel].units -= pcsInput;
    palletStock[palletModel].terpakai = Math.max(0, palletStock[palletModel].terpakai - palletsFreed);
    palletStock[palletModel].kosong += palletsFreed;

    const txId = generateTransactionID('FGO');
    const dt = getFormattedDateTime();

    const fgOutTable = document.getElementById('fgOutboundTableBody');
    if (fgOutTable) {
        const row = fgOutTable.insertRow(0);
        row.className = "hover:bg-slate-50";
        row.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${engineModel}</td>
            <td class="p-3.5 font-semibold">${palletModel}</td>
            <td class="p-3.5 font-semibold">${pcsInput} Pcs</td>
            <td class="p-3.5">${palletsFreed} Pallet</td>
        `;
    }

    const engineTable = document.getElementById('engineRunningTableBody');
    if (engineTable) {
        const erow = engineTable.insertRow(0);
        erow.className = "hover:bg-slate-50";
        erow.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${engineModel}</td>
            <td class="p-3.5 font-semibold">${palletModel}</td>
            <td class="p-3.5 font-semibold text-black-600">${pcsInput} Pcs</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-red-50 text-red-600 rounded font-medium">Outbound</span></td>
        `;
    }

    const palletTable = document.getElementById('palletRunningTableBody');
    if (palletTable) {
        const prow = palletTable.insertRow(0);
        prow.className = "hover:bg-slate-50";
        prow.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${palletModel}</td>
            <td class="p-3.5 font-semibold text-black-600">${palletsFreed} Pallet</td>
            <td class="p-3.5">Pallet Kosong</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">FG Outbound</span></td>
        `;
    }

    updateEngineStockUI();
    updatePalletUI();
    document.getElementById('fgOutEngineQtyPcs').value = '';
    document.getElementById('fgOutTotalQtyDisplay').innerText = '-';
    showToast(`Outbound FG ${pcsInput} Pcs (${palletsFreed} Pallet Kosong) Berhasil! ID: ${txId}`, 'success');
}


/* ==========================================================================
   6. PALLET MANAGEMENT TRANSACTIONS LOGIC
   ========================================================================== */

function submitPalletInput() {
    const palletId = document.getElementById('palletInputId').value;
    const qty = parseInt(document.getElementById('palletInputQty').value) || 0;
    const catatan = document.getElementById('palletInputCatatan').value || 'Penerimaan Pallet';

    if (qty <= 0) {
        showToast('Masukkan jumlah pallet yang valid!', 'warning');
        return;
    }

    palletStock[palletId].kosong += qty;

    const txId = generateTransactionID('PLE');
    const dt = getFormattedDateTime();

    const palletTable = document.getElementById('palletRunningTableBody');
    if (palletTable) {
        const prow = palletTable.insertRow(0);
        prow.className = "hover:bg-slate-50";
        prow.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${palletId}</td>
            <td class="p-3.5 font-semibold text-black-600">${qty} Pallet</td>
            <td class="p-3.5">${catatan}</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">Received</span></td>
        `;
    }

    updatePalletUI();
    document.getElementById('palletInputQty').value = '';
    document.getElementById('palletInputCatatan').value = '';
    showToast(`Berhasil menambah ${qty} Pallet Kosong (${palletId})! ID: ${txId}`, 'success');
}

function submitPalletOutput() {
    const palletId = document.getElementById('palletOutputId').value;
    const type = document.getElementById('palletOutputType').value;
    const qty = parseInt(document.getElementById('palletOutputQty').value) || 0;
    const catatan = document.getElementById('palletOutputCatatan').value || `Pallet ${type}`;

    if (qty <= 0) {
        showToast('Masukkan jumlah pallet yang valid!', 'warning');
        return;
    }

    if (type === 'NG') {
        if (palletStock[palletId].kosong < qty) {
            showToast(`Stok Pallet Kosong ${palletId} tidak mencukupi untuk di-NG-kan!`, 'error');
            return;
        }
        palletStock[palletId].kosong -= qty;
        palletStock[palletId].ng += qty;
    } else {
        if (palletStock[palletId].kosong < qty) {
            showToast(`Stok Pallet Kosong ${palletId} tidak mencukupi!`, 'error');
            return;
        }
        palletStock[palletId].kosong -= qty;
    }

    const txId = generateTransactionID('PLE');
    const dt = getFormattedDateTime();

    const palletTable = document.getElementById('palletRunningTableBody');
    if (palletTable) {
        const prow = palletTable.insertRow(0);
        prow.className = "hover:bg-slate-50";
        prow.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-black-600">${txId}</td>
            <td class="p-3.5 font-semibold">${palletId}</td>
            <td class="p-3.5 font-semibold text-black-600">${qty} Pallet</td>
            <td class="p-3.5">${catatan}</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-red-50 text-red-600 rounded font-medium">(${type})</span></td>
        `;
    }

    updatePalletUI();
    document.getElementById('palletOutputQty').value = '';
    document.getElementById('palletOutputCatatan').value = '';
    showToast(`Output Pallet ${type} (${palletId}) sejumlah ${qty} Berhasil! ID: ${txId}`, 'success');
}


/* ==========================================================================
   7. MATERIAL & CONSUMABLE TRANSACTIONS LOGIC
   ========================================================================== */

function submitMaterialInbound() {
    const pkgId = document.getElementById('inboundPackageIdInput')?.value || generateTransactionID('INB');
    const sap = document.getElementById('inboundSapInput')?.value || '-';
    const name = document.getElementById('inboundMaterialNameInput')?.value || '-';
    const batch = document.getElementById('inboundBatchInput')?.value || '-';
    const qty = parseInt(document.getElementById('inboundSparepartQtyInput').value) || 0;
    const bin = document.getElementById('inboundBinInput')?.value || '-';

    if (qty <= 0) {
        showToast('Masukkan jumlah Qty yang valid!', 'warning');
        return;
    }

    const dt = getFormattedDateTime();

    // ─── 1. TABEL DI HALAMAN INBOUND SPAREPART (7 kolom) ───
    const inboundTable = document.getElementById('inboundTableBody');
    if (inboundTable) {
        const row = inboundTable.insertRow(0);
        row.className = "hover:bg-slate-50";
        row.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-slate-800">${pkgId}</td>
            <td class="p-3.5 font-semibold">${sap}</td>
            <td class="p-3.5">${name}</td>
            <td class="p-3.5">${batch}</td>
            <td class="p-3.5 font-bold text-emerald-600">${qty} Pcs</td>
            <td class="p-3.5"><span class="px-2 py-0.5 bg-slate-100 rounded text-xs">${bin}</span></td>
        `;
    }

    // ─── 2. TABEL DI HALAMAN PENYIMPANAN (6 kolom, tanpa Lokasi) ───
    const runningInbound = document.getElementById('tableBodyRunningInbound');
    if (runningInbound) {
        const row = runningInbound.insertRow(0);
        row.className = "hover:bg-slate-50";
        row.innerHTML = `
            <td class="p-3">${dt}</td>
            <td class="p-3 font-semibold text-slate-800">${pkgId}</td>
            <td class="p-3 font-semibold">${sap}</td>
            <td class="p-3">${name}</td>
            <td class="p-3">${batch}</td>
            <td class="p-3 font-bold text-emerald-600">${qty} Pcs</td>
        `;
    }

    // ─── 3. RINGKASAN STOK (agregat per SAP) ───
    const summaryTable = document.getElementById('tableBodySummary');
    if (summaryTable) {
        // Cari baris dengan SAP yang sama
        let foundRow = null;
        Array.from(summaryTable.getElementsByTagName('tr')).forEach(tr => {
            const firstCell = tr.children[0];
            if (firstCell && firstCell.innerText.trim() === String(sap)) {
                foundRow = tr;
            }
        });

        if (foundRow) {
            // Update qty yang ada
            const qtyCell = foundRow.children[3];
            const currentQty = parseFloat((qtyCell.innerText || '0').replace(/[^\d.-]/g, '')) || 0;
            qtyCell.innerText = currentQty + qty;
        } else {
            // Buat baris baru
            const newRow = summaryTable.insertRow(0);
            newRow.className = "hover:bg-slate-50";
            newRow.innerHTML = `
                <td class="p-3.5 font-semibold text-slate-800">${sap}</td>
                <td class="p-3.5">${name}</td>
                <td class="p-3.5">${bin}</td>
                <td class="p-3.5 text-center font-bold text-slate-900">${qty}</td>
                <td class="p-3.5 text-center"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">Ready</span></td>
            `;
        }

        // Hapus placeholder "Memuat data stok..." kalau ada
        const placeholder = summaryTable.querySelector('td[colspan]');
        if (placeholder && summaryTable.getElementsByTagName('tr').length > 1) {
            placeholder.parentElement.remove();
        }
    }

    // ─── 4. SIMPAN KE LOCAL INVENTORY (untuk lookup outbound) ───
    window.inventoryStok.push({
        packageId: pkgId,
        sap: sap,
        name: name,
        batch: batch,
        location: bin,
        qty: qty
    });

    // ─── 5. RESET FORM ───
    ['inboundPackageIdInput', 'inboundSapInput', 'inboundMaterialNameInput', 
     'inboundBatchInput', 'inboundSparepartQtyInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    showToast(`Material Inbound ${qty} Items (${sap}) berhasil disimpan!`, 'success');
}

function submitMaterialOutbound() {
    const pkgId = document.getElementById('outboundPackageIdInput')?.value || generateTransactionID('OUB');
    const sap = document.getElementById('outboundSapInput')?.value || '-';
    const name = document.getElementById('outboundMaterialNameInput')?.value || '-';
    const batch = document.getElementById('outboundBatchInput')?.value || '-';
    const loc = document.getElementById('outboundLocationInput')?.value || '-';
    const qty = parseInt(document.getElementById('outboundSparepartQtyInput').value) || 0;

    if (qty <= 0) {
        showToast('Masukkan jumlah Qty yang valid!', 'warning');
        return;
    }

    const dt = getFormattedDateTime();

    const outboundTable = document.getElementById('outboundTableBody') || document.getElementById('tableBodyRunningOutbound');
    if (outboundTable) {
        const row = outboundTable.insertRow(0);
        row.className = "hover:bg-slate-50";
        row.innerHTML = `
            <td class="p-3.5">${dt}</td>
            <td class="p-3.5 font-semibold text-slate-800">${pkgId}</td>
            <td class="p-3.5 font-semibold">${sap}</td>
            <td class="p-3.5">${name}</td>
            <td class="p-3.5">${batch}</td>
            <td class="p-3.5">${loc}</td>
            <td class="p-3.5 font-bold text-rose-600">${qty} Pcs</td>
        `;
    }

    if (document.getElementById('outboundPackageIdInput')) document.getElementById('outboundPackageIdInput').value = '';
    if (document.getElementById('outboundSapInput')) document.getElementById('outboundSapInput').value = '';
    if (document.getElementById('outboundMaterialNameInput')) document.getElementById('outboundMaterialNameInput').value = '';
    if (document.getElementById('outboundBatchInput')) document.getElementById('outboundBatchInput').value = '';
    document.getElementById('outboundSparepartQtyInput').value = '';

    showToast(`Material Outbound ${qty} Items (${sap}) berhasil diproses!`, 'success');
}

function filterSummaryTable() {
    const input = document.getElementById('searchSummaryInput');
    if (!input) return;
    const filter = input.value.toLowerCase();
    const tbody = document.getElementById('tableBodySummary');
    if (!tbody) return;

    const rows = tbody.getElementsByTagName('tr');
    for (let i = 0; i < rows.length; i++) {
        const text = rows[i].innerText.toLowerCase();
        rows[i].style.display = text.includes(filter) ? '' : 'none';
    }
}


/* ==========================================================================
   8. MASTER DATA (MATERIAL, BOM, PLANNING)
   ========================================================================== */
function submitBomItem() {
    const model = document.getElementById('bomEngineModelInput').value;
    const sap = document.getElementById('bomSapInput').value;
    const name = document.getElementById('bomMaterialNameInput').value || "Piston Rod Std";
    const qty = document.getElementById('bomQtyInput').value;

    if (!model || !sap || !qty) {
        showToast("Harap lengkapi Model Engine, SAP, dan Qty!", "warning");
        return;
    }

    const rowHTML = `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="p-3 font-semibold text-slate-800">${sap}</td>
            <td class="p-3 text-slate-600">${name}</td>
            <td class="p-3 text-center font-bold text-blue-600">${qty} pcs</td>
            <td class="p-3 text-center">
                <button onclick="this.closest('tr').remove()" class="text-rose-600 hover:text-rose-800 font-semibold text-xs">Hapus</button>
            </td>
        </tr>
    `;

    if (model === 'ZQD') {
        document.getElementById('tableBodyBomZQD').insertAdjacentHTML('beforeend', rowHTML);
    } else if (model === 'ZQB') {
        document.getElementById('tableBodyBomZQB').insertAdjacentHTML('beforeend', rowHTML);
    }

    document.getElementById('bomSapInput').value = '';
    document.getElementById('bomQtyInput').value = '';
    showToast("Item BOM berhasil ditambahkan!", "success");
}

function submitPlanningProduksi() {
    const date = document.getElementById('planDateInput').value;
    const model = document.getElementById('planModelInput').value;
    const qty = document.getElementById('planQtyInput').value;

    if (!date || !model || !qty) {
        showToast("Harap isi Tanggal, Model, dan Target Qty!", "warning");
        return;
    }

    const rowHTML = `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="p-3.5 font-medium text-slate-700">${date}</td>
            <td class="p-3.5"><span class="px-2 py-0.5 ${model === 'ZQD' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'} rounded font-semibold">${model}</span></td>
            <td class="p-3.5 font-bold text-slate-800">${qty} Unit</td>
            <td class="p-3.5 text-slate-600 italic text-xs">(Menunggu Hitungan BOM)</td>
            <td class="p-3.5"><span class="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold">Menunggu Picking</span></td>
            <td class="p-3.5 text-center">
                <button onclick="this.closest('tr').remove()" class="text-rose-600 hover:text-rose-800 font-semibold text-xs">Hapus</button>
            </td>
        </tr>
    `;

    document.getElementById('planningTableBody').insertAdjacentHTML('beforeend', rowHTML);

    document.getElementById('planDateInput').value = '';
    document.getElementById('planQtyInput').value = '';
    showToast("Planning Produksi berhasil disimpan!", "success");
}


/* ==========================================================================
   9. UI UPDATERS & SINGLE INITIALIZATION
   ========================================================================== */

function updateEngineStockUI() {
    const zqdUnitEl = document.getElementById('stok-zqd-unit');
    const zqdPalletEl = document.getElementById('stok-zqd-pallet-detail');
    if (zqdUnitEl) zqdUnitEl.innerText = `${engineStock.ZQD.units} Pcs`;
    if (zqdPalletEl) zqdPalletEl.innerText = `${palletStock.ZQD.terpakai} Pallet`;

    const zqbUnitEl = document.getElementById('stok-zqb-unit');
    const zqbPalletEl = document.getElementById('stok-zqb-pallet-detail');
    if (zqbUnitEl) zqbUnitEl.innerText = `${engineStock.ZQB.units} Pcs`;
    if (zqbPalletEl) zqbPalletEl.innerText = `${palletStock.ZQB.terpakai} Pallet`;
}

function updatePalletUI() {
    // ZQD Status
    const zqdKosong = document.getElementById('pallet-zqd-kosong');
    const zqdTerpakai = document.getElementById('pallet-zqd-terpakai');
    const zqdNg = document.getElementById('pallet-zqd-ng');
    const zqdStatus = document.getElementById('pallet-zqd-status');

    if (zqdKosong) zqdKosong.innerText = `${palletStock.ZQD.kosong} Pallet`;
    if (zqdTerpakai) zqdTerpakai.innerText = `${palletStock.ZQD.terpakai} Pallet`;
    if (zqdNg) zqdNg.innerText = `${palletStock.ZQD.ng} Pallet`;
    if (zqdStatus) {
        zqdStatus.innerHTML = palletStock.ZQD.kosong > 5 
            ? `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">Ready</span>`
            : `<span class="px-2 py-0.5 bg-rose-50 text-rose-600 rounded font-medium">Low</span>`;
    }

    // ZQB Status
    const zqbKosong = document.getElementById('pallet-zqb-kosong');
    const zqbTerpakai = document.getElementById('pallet-zqb-terpakai');
    const zqbNg = document.getElementById('pallet-zqb-ng');
    const zqbStatus = document.getElementById('pallet-zqb-status');

    if (zqbKosong) zqbKosong.innerText = `${palletStock.ZQB.kosong} Pallet`;
    if (zqbTerpakai) zqbTerpakai.innerText = `${palletStock.ZQB.terpakai} Pallet`;
    if (zqbNg) zqbNg.innerText = `${palletStock.ZQB.ng} Pallet`;
    if (zqbStatus) {
        zqbStatus.innerHTML = palletStock.ZQB.kosong > 5 
            ? `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">Ready</span>`
            : `<span class="px-2 py-0.5 bg-rose-50 text-rose-600 rounded font-medium">Low</span>`;
    }

    // Occupied Ratio Widget
    const totalTerpakai = palletStock.ZQD.terpakai + palletStock.ZQB.terpakai;
    const totalPallet = totalTerpakai + palletStock.ZQD.kosong + palletStock.ZQB.kosong + palletStock.ZQD.ng + palletStock.ZQB.ng;
    const occupiedPct = totalPallet > 0 ? Math.round((totalTerpakai / totalPallet) * 100) : 0;

    const cardVal = document.getElementById('card-pallet-val');
    const cardProgress = document.getElementById('card-pallet-progress');

    if (cardVal) cardVal.innerText = `${occupiedPct}%`;
    if (cardProgress) cardProgress.style.width = `${occupiedPct}%`;
}

document.addEventListener('DOMContentLoaded', () => {
    setInterval(updateClock, 1000);
    updateClock();
    updateEngineStockUI();
    updatePalletUI();

    // Sync counter widget dengan isi running table (per hari)
    syncWidgetCounters();
    ['inboundTableBody', 'outboundTableBody', 'fgInboundTableBody', 'fgOutboundTableBody']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) new MutationObserver(syncWidgetCounters).observe(el, { childList: true });
        });
        
    // 2. Attach Event Listener Inbound Scanner
    const inboundPackageInput = document.getElementById('inboundPackageIdInput');
    if (inboundPackageInput) {
        inboundPackageInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                processScanInbound(this.value);
            }
        });
        inboundPackageInput.addEventListener('change', function () {
            processScanInbound(this.value);
        });
    }

    // 3. Attach Event Listener Outbound Scanner
    const outboundPackageInput = document.getElementById('outboundPackageIdInput');
    if (outboundPackageInput) {
        outboundPackageInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                processScanOutbound(this.value);
            }
        });
    }
});

// Array penampung Master Data Material (sesuaikan nama variabel jika berbeda di kode Anda)
window.masterMaterialList = window.masterMaterialList || [];

/**
 * Fungsi untuk mencocokkan SAP yang diketik/discan
 * dengan Master Data Material, lalu mengisi Nama Material dan Lokasi Area (Grup).
 */
function autofillMaterialInfo() {
    const sapVal = document.getElementById('inboundSapInput').value.trim();
    const nameInput = document.getElementById('inboundMaterialNameInput');
    const binInput = document.getElementById('inboundBinInput');

    if (!sapVal) {
        nameInput.value = '';
        binInput.value = '';
        return;
    }

    // Cari item berdasarkan Kode SAP di Master Data
    const foundItem = window.masterMaterialList.find(item => String(item.sap) === sapVal);

    if (foundItem) {
        nameInput.value = foundItem.namaMaterial || foundItem.nama || '';
        binInput.value = foundItem.grup || foundItem.group || '';
    } else {
        nameInput.value = '';
        binInput.value = '';
    }
}

/**
 * Pastikan saat pendaftaran/simpan Master Material baru, 
 * datanya tersimpan ke window.masterMaterialList
 */
/**
 * Submit Master Material — versi final (gabungan)
 * Simpan ke array + render ke tabel
 */
function submitMasterMaterial() {
    const sap = document.getElementById('masterSapInput').value.trim();
    const name = document.getElementById('masterMaterialNameInput').value.trim();
    const group = document.getElementById('masterGroupInput').value;
    const model = document.getElementById('masterModelInput').value;
    const snp = document.getElementById('masterSnpInput').value || 1;

    if (!sap || !name || !group || !model) {
        showToast("Harap lengkapi semua kolom input!", "warning");
        return;
    }

    // Simpan ke array (untuk autofill SAP di form Inbound)
    window.masterMaterialList.push({
        sap: sap,
        namaMaterial: name,
        grup: group,
        model: model,
        snp: snp
    });

    // Render ke tabel
    const rowHTML = `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="p-3 font-medium text-slate-700">${model === 'ZQD' ? noZqd++ : noZqb++}</td>
            <td class="p-3 font-semibold text-slate-800">${sap}</td>
            <td class="p-3 text-slate-600">${name}</td>
            <td class="p-3"><span class="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">${group}</span></td>
            <td class="p-3 text-center font-bold text-slate-700">${snp} pcs</td>
            <td class="p-3 text-center">
                <button onclick="this.closest('tr').remove()" class="text-rose-600 hover:text-rose-800 font-semibold text-xs">Hapus</button>
            </td>
        </tr>
    `;

    if (model === 'ZQD') {
        document.getElementById('tableBodyMaterialZQD')?.insertAdjacentHTML('beforeend', rowHTML);
    } else if (model === 'ZQB') {
        document.getElementById('tableBodyMaterialZQB')?.insertAdjacentHTML('beforeend', rowHTML);
    }

    // Reset form
    document.getElementById('masterSapInput').value = '';
    document.getElementById('masterMaterialNameInput').value = '';
    document.getElementById('masterGroupInput').value = '';
    document.getElementById('masterModelInput').value = '';
    document.getElementById('masterSnpInput').value = '';

    showToast("Master Material berhasil ditambahkan!", "success");
}

// ==========================================================
// WMS ENGINE - GOOGLE APPS SCRIPT DATABASE
// ==========================================================

// 1. SETUP OTOMATIS TAB & HEADER DI GOOGLE SPREADSHEET
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Daftar Tab dan Header Kolom
  const tables = [
    {
      name: 'Master_Material',
      headers: ['Kode Material (SAP)', 'Nama Material', 'Lokasi', 'Engine ID', 'SNP (Qty/Box)', 'Tanggal Input']
    },
    {
      name: 'Master_BOM',
      headers: ['BOM ID', 'Engine ID', 'Kode Material (SAP)', 'Nama Material', 'Qty Per Engine', 'Satuan']
    },
    {
      name: 'Planning_Produksi',
      headers: ['Plan ID', 'Tanggal Plan', 'Engine ID', 'Target Qty (Pcs)', 'Line Produksi', 'Status', 'Catatan']
    },
    {
      name: 'Inbound_Sparepart',
      headers: ['Tanggal & Jam', 'Package ID', 'Kode Material (SAP)', 'Nama Material', 'Batch', 'Qty', 'Lokasi']
    },
    {
      name: 'Outbound_Sparepart',
      headers: ['Tanggal & Jam', 'Package ID', 'Kode Material (SAP)', 'Nama Material', 'Batch', 'Qty', 'Lokasi']
    }
  ];

  tables.forEach(table => {
    let sheet = ss.getSheetByName(table.name);
    // Buat Tab jika belum ada
    if (!sheet) {
      sheet = ss.insertSheet(table.name);
      sheet.appendRow(table.headers);
      
      // Styling Header Otomatis (Warna Biru, Font Bold, Text Putih)
      const headerRange = sheet.getRange(1, 1, 1, table.headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#2563eb');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  });

  // Hapus tab bawaan 'Sheet1' / 'Kertas1' jika ada tab lain yang sudah dibuat
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
}

// 2. ENDPOINT GET (Mengambil Data dari Spreadsheet ke Dashboard Web)
function doGet(e) {
  setupDatabase(); // Pastikan tab selalu siap
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let result = { status: 'success', data: [] };

  try {
    if (action === 'getMasterMaterial') {
      result.data = getSheetData(ss.getSheetByName('Master_Material'));
    } else if (action === 'getMasterBOM') {
      result.data = getSheetData(ss.getSheetByName('Master_BOM'));
    } else if (action === 'getPlanningProduksi') {
      result.data = getSheetData(ss.getSheetByName('Planning_Produksi'));
    } else if (action === 'getAllData') {
      result.data = {
        masterMaterial: getSheetData(ss.getSheetByName('Master_Material')),
        masterBOM: getSheetData(ss.getSheetByName('Master_BOM')),
        planningProduksi: getSheetData(ss.getSheetByName('Planning_Produksi')),
        inbound: getSheetData(ss.getSheetByName('Inbound_Sparepart')),
        outbound: getSheetData(ss.getSheetByName('Outbound_Sparepart'))
      };
    } else {
      result = { status: 'error', message: 'Action GET tidak valid' };
    }
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Helper membaca isi Sheet ke bentuk JSON Array
function getSheetData(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // Hanya ada header
  
  const headers = data[0];
  const rows = data.slice(1);
  
  return rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      let val = row[index];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      obj[header] = val;
    });
    return obj;
  });
}

// 3. ENDPOINT POST (Menyimpan Data Baru dari Web ke Spreadsheet)
function doPost(e) {
  setupDatabase();
  let result = { status: 'success' };
  
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const payload = postData.data;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'addMasterMaterial') {
      const sheet = ss.getSheetByName('Master_Material');
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      sheet.appendRow([
        payload.sap,
        payload.namaMaterial,
        payload.grup,
        payload.model,
        payload.snp,
        now
      ]);
      result.message = 'Master Material berhasil disimpan!';
    } 
    else if (action === 'addMasterBOM') {
      const sheet = ss.getSheetByName('Master_BOM');
      sheet.appendRow([
        payload.bomId || ('BOM-' + Date.now()),
        payload.kodeEngine,
        payload.kodeSap,
        payload.namaMaterial,
        payload.qty,
        payload.satuan || 'Pcs'
      ]);
      result.message = 'Master BOM berhasil disimpan!';
    }
    else if (action === 'addPlanningProduksi') {
      const sheet = ss.getSheetByName('Planning_Produksi');
      sheet.appendRow([
        payload.planId || ('PLAN-' + Date.now()),
        payload.tanggalPlan,
        payload.kodeEngine,
        payload.targetQty,
        payload.lineProduksi || 'Line 1',
        payload.status || 'Planned',
        payload.catatan || ''
      ]);
      result.message = 'Planning Produksi berhasil disimpan!';
    }
    else if (action === 'addInbound') {
      const sheet = ss.getSheetByName('Inbound_Sparepart');
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      sheet.appendRow([
        now,
        payload.packageId,
        payload.sap,
        payload.namaMaterial,
        payload.batch,
        payload.qty,
        payload.lokasi
      ]);
      result.message = 'Inbound Material berhasil disimpan!';
    }
    else {
      result = { status: 'error', message: 'Action POST tidak dikenal' };
    }
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================================
   10. SYNC WIDGET COUNTER DENGAN RUNNING TABLE (PER HARI)
   ========================================================================== */
function syncWidgetCounters() {
    // Ambil tanggal hari ini: "DD-MM-YY" (sesuai format getFormattedDateTime)
    const today = getFormattedDateTime().split(',')[0].trim();

    // Helper: total kolom qty dari tbody, filter tanggal = hari ini
    const getTotalToday = (tbodyId, qtyColIndex) => {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return 0;

        let total = 0;
        tbody.querySelectorAll('tr').forEach(tr => {
            const cells = tr.children;

            // Cek apakah tanggal (kolom 0) = hari ini
            const dateText = (cells[0]?.innerText || '').split(',')[0].trim();
            if (dateText !== today) return;

            // Ambil Qty
            const qtyText = cells[qtyColIndex]?.innerText || '';
            const num = parseFloat(qtyText.replace(/[^\d.-]/g, ''));
            if (!isNaN(num)) total += num;
        });
        return total;
    };

    // ── WIDGET 1: Material Inbound (Qty = index 5)
    const c1 = document.getElementById('card-inbound-val');
    if (c1) c1.innerText = getTotalToday('inboundTableBody', 5);

    // ── WIDGET 2: Material Outbound (Qty = index 5)
    const c2 = document.getElementById('card-outbound-val');
    if (c2) c2.innerText = getTotalToday('outboundTableBody', 5);

    // ── WIDGET 3: FG Inbound (Qty = index 4)
    const c3 = document.getElementById('card-fg-inbound-val');
    if (c3) c3.innerText = getTotalToday('fgInboundTableBody', 4);

    // ── WIDGET 4: FG Outbound (Qty = index 4)
    const c4 = document.getElementById('card-fg-outbound-val');
    if (c4) c4.innerText = getTotalToday('fgOutboundTableBody', 4);

    // ── WIDGET 5: Antrean Picking (jumlah baris planning)
    const c5 = document.getElementById('card-picking-val');
    const planBody = document.getElementById('planningTableBody');
    if (c5 && planBody) c5.innerText = planBody.querySelectorAll('tr').length;

    // ── UPDATE SPARKLINE (grafis garis)
    const totalInbound    = parseFloat(document.getElementById('card-inbound-val')?.innerText) || 0;
    const totalOutbound   = parseFloat(document.getElementById('card-outbound-val')?.innerText) || 0;
    const totalFgInbound  = parseFloat(document.getElementById('card-fg-inbound-val')?.innerText) || 0;
    const totalFgOutbound = parseFloat(document.getElementById('card-fg-outbound-val')?.innerText) || 0;

    addHistoryPoint('inbound',    totalInbound,    'sparkline-inbound');
    addHistoryPoint('outbound',   totalOutbound,   'sparkline-outbound');
    addHistoryPoint('fgInbound',  totalFgInbound,  'sparkline-fg-inbound');
    addHistoryPoint('fgOutbound', totalFgOutbound, 'sparkline-fg-outbound');
}

/* ==========================================================================
   11. STUB FUNCTION — Fitur Consumable & Refresh (belum diimplementasi penuh)
   ========================================================================== */

function fetchInventoryData(btn) {
    // Ambil tombol — dari argumen, atau fallback ke pencarian by title
    const targetBtn = btn || document.querySelector('button[title="Refresh Data"]');
    const icon = targetBtn?.querySelector('i');

    // Trigger animasi rotate
    if (icon) {
        icon.classList.remove('spinning');  // reset dulu
        void icon.offsetWidth;              // force reflow biar animation bisa re-trigger
        icon.classList.add('spinning');
        setTimeout(() => icon.classList.remove('spinning'), 600);
    }

    // Placeholder aksi
    showToast('Data ter-refresh', 'info');
}

// Submit Inbound Consumable (placeholder)
function submitConsumableInbound() {
    const qtyInput = document.getElementById('inboundConsumableQtyInput');
    const qty = parseInt(qtyInput?.value) || 0;
    if (qty <= 0) {
        showToast('Masukkan Qty yang valid!', 'warning');
        return;
    }
    showToast(`Consumable Inbound ${qty} Items (placeholder)`, 'info');
    if (qtyInput) qtyInput.value = '';
}

// Submit Outbound Consumable (placeholder)
function submitConsumableOutbound() {
    const qtyInput = document.getElementById('outboundConsumableQtyInput');
    const qty = parseInt(qtyInput?.value) || 0;
    if (qty <= 0) {
        showToast('Masukkan Qty yang valid!', 'warning');
        return;
    }
    showToast(`Consumable Outbound ${qty} Items (placeholder)`, 'info');
    if (qtyInput) qtyInput.value = '';
}
