// ============================================================================
// TRADING JOURNAL - REFACTORED VERSION (MASIH 1 FILE)
// ============================================================================

// ================================
// SECTION 1: CONFIGURATION
// ================================

// Konfigurasi Google Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwGYbRwWwoAoTVBMBllYiSwRhaLc-WSZ4smEBt7KXY2jM5aUimdQoFp0PDXakVwuSLy/exec';
const PENDING_STORAGE_KEY = 'trading_pending_data';

// ================================
// SECTION 2: GLOBAL STATE
// ================================
let tradingData = [];
let portfolioData = { summary: null, transactions: [] };
let positions = {};
let loadingProgress = 0;
let loadingInterval;
let lineChart, pieChart, winRateChart, distributionChart;
const dashboardState = {
    dateRange: {
        mode: 'quick', // 'quick' | 'custom'
        quickFilter: '30days', // '30days', '7days', 'thismonth', 'lastmonth', 'thisyear', 'all'
        startDate: null,
        endDate: null,
        applied: false
    },
    comparison: {
        enabled: false,
        previousRange: null,
        previousData: null
    },
    currentFilteredData: []
};
// State untuk chart dan table
const chartState = {
    type: 'line', // 'line', 'bar', 'breakdown'
    data: null,
    chartInstance: null,
    dailyChartInstance: null // untuk chart breakdown
};
const stockTableState = {
    sortBy: 'totalPL',
    sortOrder: 'desc', // 'asc' or 'desc'
    limit: 5, // Top 5 stocks
    currentData: []
};

// ================================
// SECTION 3: UTILITY FUNCTIONS
// ================================
// Formatting Utilities
function formatNumber(num) {
    if (num === undefined || num === null || isNaN(num)) return '0';
    return new Intl.NumberFormat('id-ID').format(Math.round(num));
}
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}
function getTimeAgo(timestamp) {
    const now = new Date();
    const recordTime = new Date(timestamp);
    const diffMs = now - recordTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'baru saja';
    if (diffMins < 60) return `${diffMins} menit lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    return `${Math.floor(diffHours / 24)} hari lalu`;
}
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}
function formatDateToString(date) {
    console.log('🔄 formatDateToString called with:', date);
    if (!date) return null;
    
    try {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (error) {
        console.error('❌ Error formatting date:', error);
        return null;
    }
}
function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
}
function generateId() {
    return 'TRX-' + Date.now();
}
function safelyUpdateElement(elementId, text, className = '') {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
        if (className) {
            element.className = className;
        }
        console.log(`✅ Updated ${elementId}: ${text}`);
    } else {
        console.error(`❌ Element ${elementId} not found!`);
        
        // Try alternative ways to find
        const altElement = document.querySelector(`[id*="${elementId}"]`);
        if (altElement) {
            altElement.textContent = text;
            if (className) {
                altElement.className = className;
            }
            console.log(`🔍 Found alternative for ${elementId}:`, altElement);
        } else {
            console.error(`🚨 Cannot find ${elementId} anywhere!`);
        }
    }
}
// Calculation Utilities 
function calculateProfitLoss(hargaMasuk, hargaKeluar, lot, feeBuy, feeSell) {
    const totalShares = lot * 100;
    const totalBuy = hargaMasuk * totalShares;
    const totalSell = hargaKeluar * totalShares;
    
    let finalFeeBuy = feeBuy;
    let finalFeeSell = feeSell;
    
    // Jika fee kosong, hitung otomatis
    if (!feeBuy || feeBuy === 0 || !feeSell || feeSell === 0) {
        const autoFee = calculateAutoFee(hargaMasuk, hargaKeluar, lot);
        finalFeeBuy = autoFee.feeBuy;
        finalFeeSell = autoFee.feeSell;
    }
    
    const totalFee = finalFeeBuy + finalFeeSell;
    const profitLoss = totalSell - totalBuy - totalFee;
    
    return {
        profitLoss: Math.round(profitLoss),
        totalFee: totalFee,
        feeBuy: finalFeeBuy,
        feeSell: finalFeeSell,
        totalBuy: totalBuy,
        totalSell: totalSell
    };
}
function calculateAutoFee(hargaMasuk, hargaKeluar, lot) {
    const totalShares = lot * 100;
    const totalBuy = hargaMasuk * totalShares;
    const totalSell = hargaKeluar * totalShares;
    
    const feeBuy = Math.round(totalBuy * (0.1513 / 100));
    const feeSell = Math.round(totalSell * (0.25132 / 100));
    
    return {
        feeBuy: feeBuy,
        feeSell: feeSell,
        totalFee: feeBuy + feeSell
    };
}
function calculatePositionProfitLoss(position, hargaKeluar, exitLot) {
    const totalShares = exitLot * 100;
    const totalBuyValue = totalShares * position.averagePrice;
    const totalSellValue = totalShares * hargaKeluar;
    
    // Hitung allocated fee buy
    const allocatedFeeBuy = (exitLot / position.totalLot) * position.totalFeeBuy;
    
    // Hitung fee jual (0.25132%)
    const estimatedFeeSell = Math.round(totalSellValue * (0.25132 / 100));
    
    const profitLoss = totalSellValue - totalBuyValue - allocatedFeeBuy - estimatedFeeSell;
    return Math.round(profitLoss);
}
function calculateQuickFilterDates(filterType) {
    console.log('📅 calculateQuickFilterDates called for:', filterType);
    
    const today = new Date();
    let startDate = new Date();
    let endDate = new Date();
    
    switch(filterType) {
        case '30days':
            startDate.setDate(today.getDate() - 30);
            break;
        case '7days':
            startDate.setDate(today.getDate() - 7);
            break;
        case 'thismonth':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'lastmonth':
            const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            startDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
            endDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
            break;
        case 'thisyear':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        case 'all':
            // Akan di-handle khusus
            return { startDate: null, endDate: null };
        default:
            console.warn('⚠️ Unknown filter type:', filterType);
            startDate.setDate(today.getDate() - 30);
    }
    
    console.log('✅ Calculated dates:', { 
        start: formatDateToString(startDate), 
        end: formatDateToString(endDate) 
    });
    
    return { 
        startDate: formatDateToString(startDate), 
        endDate: formatDateToString(endDate) 
    };
}
function calculateMetrics(data) {
    if (!data || data.length === 0) {
        return {
            totalPL: 0,
            winRate: 0,
            totalTrades: 0,
            avgProfit: 0,
            maxProfit: 0,
            maxLoss: 0
        };
    }
    
    const totalPL = data.reduce((sum, item) => sum + (item.profitLoss || 0), 0);
    const totalTrades = data.length;
    const winningTrades = data.filter(item => (item.profitLoss || 0) > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0;
    const avgProfit = totalTrades > 0 ? (totalPL / totalTrades) : 0;
    
    let maxProfit = 0;
    let maxLoss = 0;
    
    data.forEach(item => {
        const pl = item.profitLoss || 0;
        if (pl > maxProfit) maxProfit = pl;
        if (pl < maxLoss) maxLoss = pl;
    });
    
    return { totalPL, winRate, totalTrades, avgProfit, maxProfit, maxLoss };
}
function calculateComparisonData() {
    console.log('🔍 calculateComparisonData called');
    
    const currentState = dashboardState.dateRange;
    
    if (!currentState.applied || !currentState.startDate || !currentState.endDate) {
        console.log('⚠️ No current range to compare');
        return;
    }
    
    // Hitung previous period (same duration backwards)
    const currentStart = new Date(currentState.startDate);
    const currentEnd = new Date(currentState.endDate);
    
    const durationMs = currentEnd - currentStart;
    const previousEnd = new Date(currentStart.getTime() - 1); // 1 ms sebelum start
    const previousStart = new Date(previousEnd.getTime() - durationMs);
    
    console.log('📅 Comparison periods:', {
        current: { start: currentState.startDate, end: currentState.endDate },
        previous: { start: formatDateToString(previousStart), end: formatDateToString(previousEnd) }
    });
    
    // Filter data untuk previous period
    const previousData = filterDataByDateRange(
        tradingData, 
        formatDateToString(previousStart), 
        formatDateToString(previousEnd)
    );
    
    dashboardState.comparison.previousRange = {
        start: formatDateToString(previousStart),
        end: formatDateToString(previousEnd)
    };
    dashboardState.comparison.previousData = previousData;
    
    console.log(`✅ Previous period: ${previousData.length} items`);
    
    // Update comparison UI
    updateComparisonMetrics(dashboardState.currentFilteredData, previousData);
}
// Validation Utilities
function validateTransactionAmount(amount, type, availableCash = 0) {
    console.log(`🔍 validateTransactionAmount: ${amount}, type: ${type}, cash: ${availableCash}`);
    
    const numAmount = Number(amount);
    
    // Basic validation
    if (!numAmount || numAmount <= 0 || isNaN(numAmount)) {
        return { valid: false, error: 'Jumlah harus angka positif' };
    }
    
    // ⭐⭐ TEMPORARY DISABLE untuk testing ⭐⭐
    // if (type === 'WITHDRAW' && numAmount > availableCash) {
    //     return { 
    //         valid: false, 
    //         error: `Jumlah melebihi available cash (Rp ${formatNumber(availableCash)})` 
    //     };
    // }
    
    return { valid: true };
}
function validatePositionForm(positionType) {
    console.log('🔍 Validating form for:', positionType);
    
    // Validasi umum - kode saham
    const kodeSaham = document.getElementById('kodeSaham').value;
    if (!kodeSaham) {
        return { isValid: false, message: 'Kode Saham harus diisi!' };
    }

    // ✅ VALIDASI SPESIFIK BERDASARKAN JENIS TRANSAKSI
    switch(positionType) {
        case 'new':
        case 'add':
            // Validasi untuk BELI
            const lotBeli = parseInt(document.getElementById('lot').value) || 0;
            const hargaMasuk = parseFloat(document.getElementById('hargaMasuk').value) || 0;
            
            console.log('🛒 Beli - Lot:', lotBeli, 'Harga:', hargaMasuk);
            
            if (lotBeli < 1) {
                return { isValid: false, message: 'Jumlah LOT minimal 1!' };
            }
            if (hargaMasuk <= 0) {
                return { isValid: false, message: 'Harga Beli harus diisi!' };
            }
            break;
            
        case 'close':
            // Validasi untuk TUTUP POSISI
            const hargaKeluarClose = parseFloat(document.getElementById('hargaKeluar').value) || 0;
            
            console.log('📤 Close - Harga Keluar:', hargaKeluarClose);
            
            if (hargaKeluarClose <= 0) {
                return { isValid: false, message: 'Harga Jual harus diisi!' };
            }
            break;
            
        case 'partial':
            // Validasi untuk PARTIAL EXIT
            const partialLot = parseInt(document.getElementById('partialLot').value) || 0;
            const hargaKeluarPartial = parseFloat(document.getElementById('hargaKeluar').value) || 0;
            
            console.log('🔁 Partial - Partial Lot:', partialLot, 'Harga Keluar:', hargaKeluarPartial);
            
            if (partialLot < 1) {
                return { isValid: false, message: 'Jumlah LOT jual minimal 1!' };
            }
            if (hargaKeluarPartial <= 0) {
                return { isValid: false, message: 'Harga Jual harus diisi!' };
            }
            break;
    }

    // Validasi untuk transaksi existing (add/close/partial)
    if (positionType === 'add' || positionType === 'close' || positionType === 'partial') {
        const selectedPosition = getSelectedPosition();
        if (!selectedPosition) {
            return { isValid: false, message: 'Pilih posisi terlebih dahulu!' };
        }
        
        console.log('📊 Selected Position:', selectedPosition.kodeSaham, 'Remaining Lot:', selectedPosition.remainingLot);
        
        // Validasi khusus partial exit
        if (positionType === 'partial') {
            const partialLot = parseInt(document.getElementById('partialLot').value) || 0;
            if (partialLot > selectedPosition.remainingLot) {
                return { isValid: false, message: `Jumlah LOT jual (${partialLot}) melebihi sisa LOT (${selectedPosition.remainingLot})!` };
            }
        }
    }

    console.log('✅ Validation passed for:', positionType);
    return { isValid: true, message: 'Validasi berhasil' };
}
// Helper Utilities
function parsePositionData(positionDataString) {
    try {
        if (!positionDataString || positionDataString.trim() === '') {
            return null;
        }
        
        // Coba parse sebagai JSON (untuk data baru)
        if (positionDataString.trim().startsWith('{') && positionDataString.includes('":"')) {
            return JSON.parse(positionDataString);
        }
        
        // Fallback: parse format key=value (untuk data existing)
        console.log('🔄 Parsing legacy PositionData format:', positionDataString);
        const data = {};
        
        // Clean the string - remove curly braces
        const cleanString = positionDataString.replace(/[{}]/g, '');
        
        // Split by comma and process each key=value pair
        const pairs = cleanString.split(',');
        
        pairs.forEach(pair => {
            const [key, value] = pair.split('=').map(item => item.trim());
            if (key && value !== undefined) {
                // Try to parse numbers and booleans
                if (value === 'true') data[key] = true;
                else if (value === 'false') data[key] = false;
                else if (value === 'null') data[key] = null;
                else if (!isNaN(value) && value !== '') data[key] = parseFloat(value);
                else data[key] = value;
            }
        });
        
        console.log('✅ Parsed legacy data:', data);
        return Object.keys(data).length > 0 ? data : null;
        
    } catch (error) {
        console.warn('❌ Gagal parse PositionData:', positionDataString, error);
        return null;
    }
}
function serializePositionData(positionData) {
    if (!positionData) return '';
    
    try {
        // Simpan sebagai JSON string yang valid
        return JSON.stringify(positionData);
    } catch (error) {
        console.error('❌ Gagal serialize PositionData:', error);
        
        // Fallback: format key=value legacy
        const pairs = [];
        for (const [key, value] of Object.entries(positionData)) {
            pairs.push(`${key}=${value}`);
        }
        return `{${pairs.join(', ')}}`;
    }
}
function filterDataByDateRange(data, startDate, endDate) {
    console.log('🔍 filterDataByDateRange called');
    console.log('Data count:', data.length);
    console.log('Date range:', { startDate, endDate });
    
    // Jika tidak ada tanggal, kembalikan semua data
    if (!startDate || !endDate) {
        console.log('ℹ️ No date range, returning all data');
        return [...data];
    }
    
    const filtered = data.filter(item => {
        const tradeDate = item.tanggalMasuk;
        if (!tradeDate) {
            console.warn('⚠️ Item tanpa tanggalMasuk:', item);
            return false;
        }
        
        try {
            const itemDate = new Date(tradeDate);
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            // Set waktu ke tengah malam untuk akurasi
            itemDate.setHours(0, 0, 0, 0);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            
            const isInRange = itemDate >= start && itemDate <= end;
            
            // Debug untuk beberapa item
            if (data.length < 10) {
                console.log(`Item ${item.kodeSaham} - ${tradeDate}: ${isInRange ? 'IN' : 'OUT'}`);
            }
            
            return isInRange;
            
        } catch (error) {
            console.error('❌ Error filtering item:', error, item);
            return false;
        }
    });
    
    console.log(`✅ Filtered ${filtered.length} out of ${data.length} items`);
    return filtered;
}
function getCurrentFormData() {
    // Ambil semua nilai dari form
    const formData = {
        id: generateId(),
        tanggalMasuk: document.getElementById('tanggalMasuk').value,
        tanggalKeluar: document.getElementById('tanggalKeluar').value || '',
        kodeSaham: document.getElementById('kodeSaham').value.toUpperCase(),
        hargaMasuk: parseFloat(document.getElementById('hargaMasuk').value) || 0,
        hargaKeluar: parseFloat(document.getElementById('hargaKeluar').value) || 0,
        lot: parseInt(document.getElementById('lot').value) || 1,
        feeBuy: parseFloat(document.getElementById('feeBuy').value) || 0,
        feeSell: parseFloat(document.getElementById('feeSell').value) || 0,
        metodeTrading: document.getElementById('metodeTrading').value,
        catatan: document.getElementById('catatan').value || '',
        positionData: null
    };
    
    // Hitung profit/loss jika ada harga keluar
    if (formData.hargaKeluar > 0) {
        const calculation = calculateProfitLoss(
            formData.hargaMasuk,
            formData.hargaKeluar,
            formData.lot,
            formData.feeBuy,
            formData.feeSell
        );
        formData.profitLoss = calculation.profitLoss;
        formData.totalFee = calculation.totalFee;
        formData.feeBuy = calculation.feeBuy;
        formData.feeSell = calculation.feeSell;
    } else {
        formData.profitLoss = 0;
        formData.totalFee = formData.feeBuy;
    }
    
    return formData;
}
function getSelectedPosition() {
    const existingPositions = document.getElementById('existingPositions');
    const selectedOption = existingPositions?.options[existingPositions.selectedIndex];
    
    if (!selectedOption || !selectedOption.value) return null;
    
    return JSON.parse(selectedOption.getAttribute('data-position'));
}
function getCurrentInsights() {
    const performance = document.getElementById('insightPerformance');
    const patterns = document.getElementById('insightPatterns');
    const risks = document.getElementById('insightRisks');
    
    return {
        performance: performance ? performance.innerText : '',
        patterns: patterns ? patterns.innerText : '',
        risks: risks ? risks.innerText : ''
    };
}
function createDashboardExport(snapshot) {
    let content = '=== TRADING DASHBOARD EXPORT ===\n';
    content += `Export Date: ${new Date(snapshot.timestamp).toLocaleString('id-ID')}\n`;
    content += '=================================\n\n';
    
    // Date Range
    content += '📅 DATE RANGE:\n';
    if (snapshot.dateRange.applied && snapshot.dateRange.startDate && snapshot.dateRange.endDate) {
        content += `   ${snapshot.dateRange.startDate} to ${snapshot.dateRange.endDate}\n`;
        if (snapshot.dateRange.mode === 'quick') {
            content += `   Quick Filter: ${snapshot.dateRange.quickFilter}\n`;
        }
    } else {
        content += '   All Time Data\n';
    }
    content += '\n';
    
    // Performance Metrics
    content += '📊 PERFORMANCE METRICS:\n';
    content += `   Total P/L: ${formatCurrency(snapshot.metrics.totalPL)}\n`;
    content += `   Win Rate: ${snapshot.metrics.winRate}%\n`;
    content += `   Total Trades: ${snapshot.metrics.totalTrades}\n`;
    content += '\n';
    
    // Top Stocks
    content += '📋 TOP PERFORMING STOCKS:\n';
    if (snapshot.topStocks && snapshot.topStocks.length > 0) {
        snapshot.topStocks.forEach((stock, index) => {
            content += `   ${index + 1}. ${stock.stock}: ${formatCurrency(stock.totalPL)} (${stock.winRate.toFixed(1)}% WR, ${stock.trades} trades)\n`;
        });
    } else {
        content += '   No stock data available\n';
    }
    content += '\n';
    
    // Insights
    content += '💡 TRADING INSIGHTS:\n';
    content += 'Performance:\n';
    content += snapshot.insights.performance.split('\n').map(line => `   ${line}`).join('\n');
    content += '\n\nPatterns:\n';
    content += snapshot.insights.patterns.split('\n').map(line => `   ${line}`).join('\n');
    content += '\n\nRisks:\n';
    content += snapshot.insights.risks.split('\n').map(line => `   ${line}`).join('\n');
    content += '\n\n=================================\n';
    content += 'Exported from Trading Journal App\n';
    
    return content;
}
// ================================
// SECTION 4: SYNC SYSTEM FUNCTIONS
// ================================
// Pending Data Management
function getPendingData() {
    const stored = localStorage.getItem(PENDING_STORAGE_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    
    // Initialize baru jika tidak ada
    return {
        pending_records: [],
        last_sync_attempt: null,
        pending_count: 0,
        last_update: new Date().toISOString()
    };
}
function addToPendingQueue(tradingRecord) {
    const pendingData = getPendingData();
    
    const pendingRecord = {
        id: `PENDING-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        data: tradingRecord,
        status: 'pending',
        retryCount: 0
    };
    
    pendingData.pending_records.push(pendingRecord);
    pendingData.pending_count = pendingData.pending_records.length;
    pendingData.last_update = new Date().toISOString();
    
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingData));
    
    console.log('📝 Added to pending queue:', pendingRecord.id);
    // ✅ BARU: Update badge UI setelah menambah data
    updatePendingBadge();
    return pendingRecord.id;
}
function clearPendingData() {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({
        pending_records: [],
        last_sync_attempt: new Date().toISOString(),
        pending_count: 0,
        last_update: new Date().toISOString()
    }));
    console.log('🧹 Cleared pending data');
}
function testPendingSystem() {
    console.log('🧪 Testing pending system...');
    const testData = {
        id: 'TEST-123',
        kodeSaham: 'TEST',
        lot: 1,
        hargaMasuk: 1000
    };
    
    const pendingId = addToPendingQueue(testData);
    const pendingData = getPendingData();
    
    console.log('Pending data after test:', pendingData);
    return pendingId;
}
// Auto-Sync System
function setupAutoSync() {
    console.log('🔧 Setting up auto-sync system...');
    
    // Remove existing listeners first
    window.removeEventListener('online', handleOnlineEvent);
    window.removeEventListener('offline', handleOfflineEvent);
    
    function handleOnlineEvent() {
        console.log('🌐 Online detected - checking pending data...');
        const pendingData = getPendingData();
        
        if (pendingData.pending_count > 0) {
            console.log(`🔄 Found ${pendingData.pending_count} pending records - syncing now!`);
            
            // ✅ BARU: Tampilkan notifikasi bahwa sync akan dilakukan
            showNotification(
                'info',
                '🔄 Sync Dimulai',
                `Ditemukan ${pendingData.pending_count} data pending.\n\nMenyinkronisasi ke Google Sheets...`,
                false
            );
            
            // Sync immediately dengan delay kecil
            setTimeout(() => {
                processPendingSync();
            }, 2000);
        } else {
            console.log('✅ No pending data to sync');
            // ✅ BARU: Tampilkan status online saja
            showNotification(
                'success',
                '🌐 Online',
                'Koneksi internet tersedia.\n\nData baru akan langsung disimpan ke cloud.',
                true
            );
        }
        
        // ✅ BARU: Update status indicator
        updateStatusIndicator();
    }
    
    function handleOfflineEvent() {
        console.log('📴 Offline mode - data will be saved locally');
        showOfflineNotification();
        updateStatusIndicator();
    }
    
    // Add event listeners
    window.addEventListener('online', handleOnlineEvent);
    window.addEventListener('offline', handleOfflineEvent);
    
    console.log('✅ Auto-sync system ready');
    console.log('Current online status:', navigator.onLine ? '🌐 ONLINE' : '📴 OFFLINE');
    
    // ✅ BARU: Initial status update
    updateStatusIndicator();
}
async function processPendingSync() {
    const pendingData = getPendingData();
    
    if (pendingData.pending_count === 0) {
        console.log('✅ No pending data to sync');
        return;
    }
    
    console.log(`🔄 Syncing ${pendingData.pending_count} pending records...`);
    
    // Show sync progress
    showSyncProgress(pendingData.pending_count);
    
    try {
        // Update status sync attempt
        const updatedPendingData = getPendingData();
        updatedPendingData.last_sync_attempt = new Date().toISOString();
        localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(updatedPendingData));
        
        // REAL SYNC: Load current data first
        await loadData();
        
        // Combine existing data with pending data
        const allData = [...tradingData];
        
        for (const pendingRecord of pendingData.pending_records) {
            allData.push(pendingRecord.data);
            console.log('➕ Adding pending record:', pendingRecord.data.kodeSaham);
        }
        
        console.log('📤 Sending combined data to Sheets:', allData.length, 'records');
        
        // Send to Google Sheets
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'saveAllData',
                jsonData: JSON.stringify(allData)
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Pending data synced successfully:', result);
            
            // Clear pending data
            clearPendingData();
            
            // Update tradingData dengan data terbaru
            tradingData = allData;
            smartSyncPortfolio();
            // Update UI
            updatePendingBadge();
            updateHomeSummary();
            displayTradingData();
            
            showSyncSuccessNotification(pendingData.pending_count);
            
        } else {
            throw new Error('Sync failed with status: ' + response.status);
        }
        
    } catch (error) {
        console.error('❌ Pending sync failed:', error);
        showSyncErrorNotification();
    }
}

// Smart Save System
async function smartSaveData() {
    console.log('💾 Smart save process started...');
    
    // ✅ Get current form data
    const currentData = getCurrentFormData();
    console.log('📝 Form data captured:', currentData.kodeSaham);
    
    // ✅ CEK ONLINE/OFFLINE - ROUTING LOGIC
    if (!navigator.onLine) {
        console.log('📴 Offline mode - saving to pending queue');
        
        // Simpan ke pending queue
        const pendingId = addToPendingQueue(currentData);
        
        // Tambahkan ke tradingData sementara untuk UI consistency
        tradingData.push(currentData);
        
        // Update UI
        updateHomeSummary();
        displayTradingData();
        updateManualSyncButton();
        refreshDashboard();
        
        showOfflineSuccessNotification(pendingId);
        return { success: true, mode: 'offline', pendingId: pendingId };
    }
    
    // ✅ ONLINE MODE: Langsung save ke Sheets
    console.log('🌐 Online mode - saving directly to Sheets');
    
    try {
        // Cek jika ada pending data yang perlu di-sync dulu
        const pendingData = getPendingData();
        if (pendingData.pending_count > 0) {
            console.log(`🔄 Found ${pendingData.pending_count} pending records - syncing first...`);
            await processPendingSync(); // Sync pending data dulu
        }
        
        // Tambahkan data baru ke existing data
        tradingData.push(currentData);
        
        console.log('📤 Sending data to Sheets:', tradingData.length, 'records');
        
        // Kirim ke Google Sheets
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'saveAllData',
                jsonData: JSON.stringify(tradingData)
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Data saved directly to Sheets:', result);
            setTimeout(() => {
                smartSyncPortfolio();
            }, 300);
            
            showOnlineSuccessNotification();
            return { success: true, mode: 'online' };
            
        } else {
            throw new Error('Save failed with status: ' + response.status);
        }
        
    } catch (error) {
        console.error('❌ Online save failed, falling back to pending queue:', error);
        
        // Fallback: simpan ke pending queue
        const pendingId = addToPendingQueue(currentData);
        
        // Rollback: hapus dari tradingData karena gagal save
        tradingData.pop();
        
        showSaveErrorNotification(error.message);
        return { success: false, mode: 'offline_fallback', pendingId: pendingId };
    }
}
async function smartSavePositionData(positionData) {
    console.log('💾 Smart save position process started...');
    
    // ✅ CEK ONLINE/OFFLINE - ROUTING LOGIC
    if (!navigator.onLine) {
        console.log('📴 Offline mode - saving position to pending queue');
        
        // Simpan ke pending queue
        const pendingId = addToPendingQueue(positionData);
        
        // Tambahkan ke tradingData sementara untuk UI consistency
        tradingData.push(positionData);
        
        // Update UI
        updateHomeSummary();
        displayTradingData();
        refreshDashboard();
        
        showOfflineSuccessNotification(pendingId);
        return { success: true, mode: 'offline', pendingId: pendingId };
    }
    
    // ✅ ONLINE MODE: Langsung save ke Sheets
    console.log('🌐 Online mode - saving position directly to Sheets');
    
    try {
        // Cek jika ada pending data yang perlu di-sync dulu
        const pendingData = getPendingData();
        if (pendingData.pending_count > 0) {
            console.log(`🔄 Found ${pendingData.pending_count} pending records - syncing first...`);
            await processPendingSync(); // Sync pending data dulu
        }
        
        // Tambahkan data baru ke existing data
        tradingData.push(positionData);
        
        console.log('📤 Sending position data to Sheets:', tradingData.length, 'records');
        
        // Kirim ke Google Sheets
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'saveAllData',
                jsonData: JSON.stringify(tradingData)
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Position data saved directly to Sheets:', result);
            setTimeout(() => {
                smartSyncPortfolio();
           }, 300);
            
            showOnlineSuccessNotification();
            return { success: true, mode: 'online' };
            
        } else {
            throw new Error('Save failed with status: ' + response.status);
        }
        
    } catch (error) {
        console.error('❌ Online save failed, falling back to pending queue:', error);
        
        // Fallback: simpan ke pending queue
        const pendingId = addToPendingQueue(positionData);
        
        // Rollback: hapus dari tradingData karena gagal save
        const index = tradingData.findIndex(item => item.id === positionData.id);
        if (index > -1) {
            tradingData.splice(index, 1);
        }
        
        showSaveErrorNotification(error.message);
        return { success: false, mode: 'offline_fallback', pendingId: pendingId };
    }
}
// UI Indicators
function createPendingBadge() {
    // Cek jika badge sudah ada
    if (document.getElementById('pending-badge')) {
        return document.getElementById('pending-badge');
    }
    
    const badge = document.createElement('div');
    badge.id = 'pending-badge';
    badge.style.cssText = `
        position: fixed;
        top: 15px;
        right: 15px;
        background: linear-gradient(135deg, #e74c3c, #c0392b);
        color: white;
        padding: 8px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
        animation: pulse 2s infinite;
        cursor: pointer;
        display: none;
        align-items: center;
        gap: 5px;
    `;
    
    badge.innerHTML = `
        <span>⏳</span>
        <span id="pending-count">0</span>
        <span>Pending</span>
    `;
    
    // Click to show pending details
    badge.addEventListener('click', showPendingDetails);
    
    document.body.appendChild(badge);
    return badge;
}
function updatePendingBadge() {
    const badge = createPendingBadge();
    const pendingData = getPendingData();
    const countElement = document.getElementById('pending-count');
    
    if (pendingData.pending_count > 0) {
        countElement.textContent = pendingData.pending_count;
        badge.style.display = 'flex';
        
        // Add tooltip dengan info lebih detail
        badge.title = `${pendingData.pending_count} data pending menunggu sync\nKlik untuk detail`;
        
        // Animation based on count
        if (pendingData.pending_count > 3) {
            badge.style.animation = 'pulse 1s infinite';
            badge.style.background = 'linear-gradient(135deg, #e74c3c, #d35400)';
        } else {
            badge.style.animation = 'pulse 2s infinite';
            badge.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
        }
        
        console.log(`📋 Pending badge updated: ${pendingData.pending_count} records`);
    } else {
        badge.style.display = 'none';
        console.log('✅ No pending records - badge hidden');
    }
}
function showPendingDetails() {
    const pendingData = getPendingData();
    
    if (pendingData.pending_count === 0) {
        showNotification('info', '📋 Data Pending', 'Tidak ada data pending yang menunggu sync.', true);
        return;
    }
    
    let detailsHTML = `Anda memiliki ${pendingData.pending_count} data pending:\n\n`;
    
    pendingData.pending_records.forEach((record, index) => {
        const timeAgo = getTimeAgo(record.timestamp);
        const sahamInfo = record.data.kodeSaham ? `${record.data.kodeSaham} - ${record.data.lot} lot` : 'Data trading';
        detailsHTML += `${index + 1}. ${sahamInfo} (${timeAgo})\n`;
    });
    
    detailsHTML += `\nStatus: ${navigator.onLine ? '🌐 ONLINE - Akan sync otomatis' : '📴 OFFLINE - Menunggu koneksi'}`;
    
    if (!navigator.onLine) {
        detailsHTML += `\n\nKlik tombol "🔄 Sync Now" di pojok kanan bawah untuk sync manual.`;
    }
    
    showNotification('warning', '⏳ Data Pending', detailsHTML, false);
}
function createStatusIndicator() {
    // Cek jika indicator sudah ada
    if (document.getElementById('status-indicator')) {
        return document.getElementById('status-indicator');
    }
    
    const indicator = document.createElement('div');
    indicator.id = 'status-indicator';
    indicator.style.cssText = `
        position: fixed;
        top: 15px;
        left: 15px;
        padding: 6px 12px;
        border-radius: 15px;
        font-size: 11px;
        font-weight: bold;
        z-index: 9998;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 5px;
    `;
    
    document.body.appendChild(indicator);
    updateStatusIndicator();
    return indicator;
}
function updateStatusIndicator() {
    const indicator = createStatusIndicator();
    
    if (navigator.onLine) {
        indicator.innerHTML = '🌐 Online';
        indicator.style.background = 'linear-gradient(135deg, #2ecc71, #27ae60)';
        indicator.style.color = 'white';
    } else {
        indicator.innerHTML = '📴 Offline';
        indicator.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
        indicator.style.color = 'white';
    }
}
function setupStatusIndicator() {
    window.addEventListener('online', function() {
        updateStatusIndicator();
        console.log('✅ Status: Online');
    });
    
    window.addEventListener('offline', function() {
        updateStatusIndicator();
        console.log('❌ Status: Offline');
    });
    
    // Initial setup
    updateStatusIndicator();
}
function addManualSyncButton() {
    // Cek jika button sudah ada
    if (document.getElementById('manual-sync-btn')) return;
    
    const syncBtn = document.createElement('button');
    syncBtn.id = 'manual-sync-btn';
    syncBtn.innerHTML = '🔄 Sync Now';
    syncBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #3498db, #2980b9);
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        z-index: 9997;
        box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
        display: none;
    `;
    
    syncBtn.addEventListener('click', function() {
        const pendingData = getPendingData();
        if (pendingData.pending_count > 0) {
            processPendingSync();
        } else {
            showNotification('info', 'ℹ️ Info', 'Tidak ada data pending yang perlu di-sync.', true);
        }
    });
    
    document.body.appendChild(syncBtn);
}
function updateManualSyncButton() {
    const syncBtn = document.getElementById('manual-sync-btn');
    const pendingData = getPendingData();
    
    if (syncBtn) {
        if (pendingData.pending_count > 0 && !navigator.onLine) {
            syncBtn.style.display = 'block';
            syncBtn.innerHTML = `🔄 Sync ${pendingData.pending_count} Data`;
        } else {
            syncBtn.style.display = 'none';
        }
    }
}
// Metrics Functions
function updateFilteredMetrics(filteredData) {
    console.log('📊 updateFilteredMetrics called with', filteredData?.length || 0, 'items');
    
    // Debug: Check what data we're getting
    console.log('🔍 First 3 items sample:', filteredData?.slice(0, 3));
    
    // Debug: Check if elements exist BEFORE trying to update
    console.log('🔍 Checking elements before update:');
    const elementIds = ['filteredTotalPL', 'filteredWinRate', 'filteredTotalTrades', 
                       'filteredAvgProfit', 'filteredMaxProfit', 'filteredMaxLoss'];
    
    elementIds.forEach(id => {
        const el = document.getElementById(id);
        console.log(`   ${id}:`, el ? 'FOUND' : 'NOT FOUND');
    });
    
    if (!filteredData || filteredData.length === 0) {
        console.log('ℹ️ No data to display');
        
        // Reset semua metrics DENGAN ERROR HANDLING
        safelyUpdateElement('filteredTotalPL', 'Rp 0', 'metric-value');
        safelyUpdateElement('filteredWinRate', '0%', 'metric-value');
        safelyUpdateElement('filteredTotalTrades', '0', 'metric-value');
        safelyUpdateElement('filteredAvgProfit', 'Rp 0', 'metric-value');
        safelyUpdateElement('filteredMaxProfit', 'Rp 0', 'metric-value');
        safelyUpdateElement('filteredMaxLoss', 'Rp 0', 'metric-value');
        
        // Reset trends
        document.querySelectorAll('.metric-trend').forEach(el => {
            el.textContent = '';
            el.className = 'metric-trend';
        });
        
        return;
    }
    
    // Hitung metrics DENGAN VALIDASI
    let totalPL = 0;
    let validItems = 0;
    
    filteredData.forEach(item => {
        const pl = parseFloat(item.profitLoss);
        if (!isNaN(pl)) {
            totalPL += pl;
            validItems++;
        } else {
            console.warn('⚠️ Invalid profitLoss:', item.profitLoss, 'in item:', item);
        }
    });
    
    const totalTrades = validItems;
    const winningTrades = filteredData.filter(item => {
        const pl = parseFloat(item.profitLoss);
        return !isNaN(pl) && pl > 0;
    }).length;
    
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0;
    const avgProfit = totalTrades > 0 ? (totalPL / totalTrades) : 0;
    
    // Temukan max profit dan max loss
    let maxProfit = 0;
    let maxLoss = 0;
    
    filteredData.forEach(item => {
        const pl = parseFloat(item.profitLoss);
        if (!isNaN(pl)) {
            if (pl > maxProfit) maxProfit = pl;
            if (pl < maxLoss) maxLoss = pl;
        }
    });
    
    console.log('📈 Calculated metrics:', {
        totalPL, 
        totalTrades: `${validItems}/${filteredData.length} valid items`,
        winningTrades, 
        winRate, 
        avgProfit, 
        maxProfit, 
        maxLoss
    });
    
    // Update display DENGAN SAFE FUNCTION
    safelyUpdateElement('filteredTotalPL', formatCurrency(totalPL), 
                       `metric-value ${totalPL >= 0 ? 'positive' : 'negative'}`);
    
    safelyUpdateElement('filteredWinRate', `${winRate.toFixed(1)}%`, 'metric-value');
    safelyUpdateElement('filteredTotalTrades', totalTrades.toString(), 'metric-value');
    safelyUpdateElement('filteredAvgProfit', formatCurrency(avgProfit), 'metric-value');
    safelyUpdateElement('filteredMaxProfit', formatCurrency(maxProfit), 'metric-value positive');
    safelyUpdateElement('filteredMaxLoss', formatCurrency(maxLoss), 'metric-value negative');
    
    // Update comparison jika aktif
    if (dashboardState.comparison.enabled && dashboardState.comparison.previousData) {
        updateComparisonMetrics(filteredData, dashboardState.comparison.previousData);
    }

    // Update Phase 2 components
    if (typeof updateAllPhase2Components === 'function') {
        setTimeout(() => {
            updateAllPhase2Components();
        }, 100);
    }
}
function updateComparisonMetrics(currentData, previousData) {
    console.log('🔄 updateComparisonMetrics called');
    
    const currentMetrics = calculateMetrics(currentData);
    const previousMetrics = calculateMetrics(previousData);
    
    // Update trends untuk setiap metric
    updateTrendDisplay('plTrend', currentMetrics.totalPL, previousMetrics.totalPL, 'currency');
    updateTrendDisplay('winRateTrend', currentMetrics.winRate, previousMetrics.winRate, 'percentage');
    updateTrendDisplay('tradesTrend', currentMetrics.totalTrades, previousMetrics.totalTrades, 'count');
    updateTrendDisplay('avgProfitTrend', currentMetrics.avgProfit, previousMetrics.avgProfit, 'currency');
    updateTrendDisplay('maxProfitTrend', currentMetrics.maxProfit, previousMetrics.maxProfit, 'currency');
    updateTrendDisplay('maxLossTrend', currentMetrics.maxLoss, previousMetrics.maxLoss, 'currency');
}
function updateTrendDisplay(elementId, currentValue, previousValue, type = 'currency') {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (previousValue === 0 || previousValue === null) {
        element.textContent = '';
        element.className = 'metric-trend';
        return;
    }
    
    const difference = currentValue - previousValue;
    const percentage = previousValue !== 0 ? (difference / Math.abs(previousValue)) * 100 : 0;
    
    let displayText = '';
    
    switch(type) {
        case 'currency':
            displayText = `${difference >= 0 ? '+' : ''}${formatCurrency(difference)}`;
            break;
        case 'percentage':
            displayText = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(1)}%`;
            break;
        case 'count':
            displayText = `${difference >= 0 ? '+' : ''}${difference} trades`;
            break;
        default:
            displayText = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(1)}%`;
    }
    
    element.textContent = displayText;
    
    // Set warna berdasarkan trend
    if (difference > 0) {
        element.className = 'metric-trend trend-up';
    } else if (difference < 0) {
        element.className = 'metric-trend trend-down';
    } else {
        element.className = 'metric-trend trend-neutral';
    }
}
function updateFilterStatusDisplay() {
    console.log('🔄 updateFilterStatusDisplay called');
    
    const filterText = document.getElementById('filterText');
    const filterInfo = document.getElementById('filterInfo');
    
    if (!filterText || !filterInfo) {
        console.error('❌ Filter status elements not found');
        return;
    }
    
    const state = dashboardState.dateRange;
    
    if (!state.applied) {
        filterText.textContent = 'Menampilkan semua data trading';
        filterInfo.textContent = '';
        return;
    }
    
    if (state.mode === 'quick') {
        const filterLabels = {
            '30days': '30 Hari Terakhir',
            '7days': '7 Hari Terakhir', 
            'thismonth': 'Bulan Ini',
            'lastmonth': 'Bulan Lalu',
            'thisyear': 'Tahun Ini',
            'all': 'Semua Data'
        };
        
        filterText.textContent = `Filter: ${filterLabels[state.quickFilter]}`;
        
        if (state.startDate && state.endDate) {
            const start = new Date(state.startDate);
            const end = new Date(state.endDate);
            
            const startStr = start.toLocaleDateString('id-ID', { 
                day: 'numeric', 
                month: 'short' 
            });
            const endStr = end.toLocaleDateString('id-ID', { 
                day: 'numeric', 
                month: 'short',
                year: 'numeric'
            });
            
            filterInfo.textContent = `${startStr} - ${endStr}`;
        }
        
    } else if (state.mode === 'custom') {
        if (state.startDate && state.endDate) {
            const start = new Date(state.startDate);
            const end = new Date(state.endDate);
            
            const startStr = start.toLocaleDateString('id-ID', { 
                day: 'numeric', 
                month: 'short',
                year: 'numeric'
            });
            const endStr = end.toLocaleDateString('id-ID', { 
                day: 'numeric', 
                month: 'short',
                year: 'numeric'
            });
            
            filterText.textContent = `Periode: ${startStr} - ${endStr}`;
            filterInfo.textContent = `${dashboardState.currentFilteredData.length} trades`;
        }
    }
}
// State Management
function saveDashboardState() {
    try {
        localStorage.setItem('dashboardState', JSON.stringify(dashboardState));
        console.log('💾 Dashboard state saved to localStorage');
    } catch (error) {
        console.error('❌ Error saving dashboard state:', error);
    }
}
function loadDashboardState() {
    try {
        const saved = localStorage.getItem('dashboardState');
        if (saved) {
            const parsed = JSON.parse(saved);
            
            // Merge dengan default state
            Object.assign(dashboardState, parsed);
            
            console.log('📂 Dashboard state loaded from localStorage:', dashboardState);
            
            // Restore UI berdasarkan saved state
            restoreUIFromState();
            
            // Restore comparison toggle
            const compareToggle = document.getElementById('compareToggle');
            if (compareToggle) {
                compareToggle.checked = dashboardState.comparison.enabled;
                toggleComparison(dashboardState.comparison.enabled);
            }
        }
    } catch (error) {
        console.error('❌ Error loading dashboard state:', error);
    }
}
function restoreUIFromState() {
    const state = dashboardState.dateRange;
    
    // Restore quick filter buttons
    if (state.mode === 'quick' && state.quickFilter) {
        const quickBtn = document.querySelector(`[data-range="${state.quickFilter}"]`);
        if (quickBtn) {
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            quickBtn.classList.add('active');
            highlightQuickFilter();
        }
    }
    
    // Restore date inputs jika custom mode
    if (state.mode === 'custom' && state.startDate && state.endDate) {
        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        
        if (startInput) startInput.value = state.startDate;
        if (endInput) endInput.value = state.endDate;
        
        highlightCustomRange(true);
    }
    
    // ENABLE semua inputs
    enableDateInputs();
}
// Chart Functions (Phase 2)
function initializePhase2Features() {
    console.log('🚀 Initializing Phase 2 features');
    
    setupChartControls();
    setupStockTable();
    setupInsightsPanel();
    setupDashboardActions();
    
    // Initial render setelah data loaded
    setTimeout(() => {
        updateAllPhase2Components();
    }, 1000);
}
function setupChartControls() {
    console.log('📈 Setting up chart controls');
    
    // Chart type buttons
    document.querySelectorAll('.chart-type-btn').forEach(button => {
        button.addEventListener('click', function() {
            const chartType = this.dataset.chartType;
            console.log('🎯 Chart type selected:', chartType);
            
            // Update active state
            document.querySelectorAll('.chart-type-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Update chart state
            chartState.type = chartType;
            
            // Update chart
            updateChartBasedOnType();
            
            // Update chart period info
            updateChartPeriodInfo();
        });
    });
    
    console.log('✅ Chart controls setup complete');
}
function updateChartBasedOnType() {
    console.log('🔄 Updating chart type to:', chartState.type);
    
    const dataToUse = dashboardState.currentFilteredData.length > 0 
        ? dashboardState.currentFilteredData 
        : tradingData;
    
    switch(chartState.type) {
        case 'line':
            updateLineChart(dataToUse);
            break;
        case 'bar':
            updateBarChart(dataToUse);
            break;
        case 'breakdown':
            updateDailyBreakdownChart(dataToUse);
            break;
        default:
            updateLineChart(dataToUse);
    }
}
function updateChartPeriodInfo() {
    console.log('📅 Updating chart period info');
    
    const periodText = document.getElementById('chartPeriodText');
    const dataInfo = document.getElementById('chartDataInfo');
    
    if (!periodText || !dataInfo) return;
    
    const state = dashboardState.dateRange;
    const data = dashboardState.currentFilteredData.length > 0 
        ? dashboardState.currentFilteredData 
        : tradingData;
    
    let periodLabel = '';
    let infoText = '';
    
    if (state.applied && state.startDate && state.endDate) {
        const start = new Date(state.startDate);
        const end = new Date(state.endDate);
        
        const startStr = start.toLocaleDateString('id-ID', { 
            day: 'numeric', 
            month: 'short' 
        });
        const endStr = end.toLocaleDateString('id-ID', { 
            day: 'numeric', 
            month: 'short',
            year: 'numeric'
        });
        
        periodLabel = `${chartState.type === 'line' ? 'Trend' : 'Performance'} ${startStr} - ${endStr}`;
        infoText = `${data.length} trades`;
        
    } else {
        periodLabel = 'All Time Performance';
        infoText = `${data.length} total trades`;
    }
    
    // Add chart type
    const chartTypes = {
        'line': 'Line Chart',
        'bar': 'Bar Chart', 
        'breakdown': 'Daily Breakdown'
    };
    
    periodText.textContent = `${chartTypes[chartState.type]} - ${periodLabel}`;
    dataInfo.textContent = infoText;
    
    console.log('✅ Chart period info updated:', periodLabel);
}
function showSyncProgress(count) {
    const modal = document.getElementById('notificationModal');
    const content = document.getElementById('notificationContent');
    const icon = document.getElementById('notificationIcon');
    const title = document.getElementById('notificationTitle');
    const message = document.getElementById('notificationMessage');
    const btn = document.getElementById('notificationBtn');
    
    // Setup sync progress UI
    content.className = 'notification-content notification-info';
    icon.textContent = '🔄';
    icon.style.color = '#3498db';
    title.textContent = '🔄 Sedang Sync Data';
    message.innerHTML = `
        <div style="text-align: center;">
            <div style="margin-bottom: 15px;">Menyinkronisasi ${count} data pending ke Google Sheets...</div>
            <div style="display: inline-block; width: 100%; height: 6px; background: #ecf0f1; border-radius: 3px; overflow: hidden;">
                <div id="syncProgressBar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.5s ease;"></div>
            </div>
            <div id="syncProgressText" style="margin-top: 8px; font-size: 12px; color: #7f8c8d;">Memulai...</div>
        </div>
    `;
    btn.style.display = 'none';
    
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    // Simulate progress (in real app, this would be based on actual sync progress)
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 100) progress = 100;
        
        const progressBar = document.getElementById('syncProgressBar');
        const progressText = document.getElementById('syncProgressText');
        
        if (progressBar && progressText) {
            progressBar.style.width = progress + '%';
            progressText.textContent = `Progress: ${Math.min(100, Math.round(progress))}%`;
        }
        
        if (progress >= 100) {
            clearInterval(progressInterval);
            setTimeout(() => {
                closeNotification();
            }, 500);
        }
    }, 300);
}
// Stock Table Functions
function setupStockTable() {
    console.log('📋 Setting up stock table');
    
    // Sortable headers
    document.querySelectorAll('#stockPerformanceTable th.sortable').forEach(th => {
        th.addEventListener('click', function() {
            const sortBy = this.dataset.sort;
            console.log('🎯 Sorting by:', sortBy);
            
            // Toggle sort order
            if (stockTableState.sortBy === sortBy) {
                stockTableState.sortOrder = stockTableState.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                stockTableState.sortBy = sortBy;
                stockTableState.sortOrder = 'desc'; // Default descending
            }
            
            // Update UI
            updateSortIcons();
            
            // Update table
            updateStockTable();
        });
    });
    
    // Refresh button
    document.getElementById('refreshStockTable')?.addEventListener('click', function() {
        console.log('🔄 Refreshing stock table');
        updateStockTable();
    });
    
    // Export button
    document.getElementById('exportStockTable')?.addEventListener('click', function() {
        console.log('📥 Exporting stock table');
        exportStockTable();
    });
    
    console.log('✅ Stock table setup complete');
}
function updateStockTable() {
    console.log('🔄 Updating stock table');
    
    const data = dashboardState.currentFilteredData.length > 0 
        ? dashboardState.currentFilteredData 
        : tradingData;
    
    if (!data || data.length === 0) {
        renderEmptyStockTable();
        return;
    }
    
    // Analyze stock performance
    const stockPerformance = analyzeStockPerformance(data);
    
    // Sort berdasarkan setting
    const sortedStocks = sortStocks(stockPerformance, stockTableState.sortBy, stockTableState.sortOrder);
    
    // Limit to top N
    const limitedStocks = sortedStocks.slice(0, stockTableState.limit);
    
    // Update state
    stockTableState.currentData = limitedStocks;
    
    // Render table
    renderStockTable(limitedStocks);
    
    // Update summary
    updateTableSummary(limitedStocks, stockPerformance);
    
    console.log(`✅ Stock table updated: ${limitedStocks.length} stocks`);
}
function analyzeStockPerformance(data) {
    console.log('🔍 Analyzing stock performance from', data.length, 'trades');
    
    const stockData = {};
    
    data.forEach(trade => {
        const stock = trade.kodeSaham || 'UNKNOWN';
        
        if (!stockData[stock]) {
            stockData[stock] = {
                stock: stock,
                trades: 0,
                wins: 0,
                losses: 0,
                totalPL: 0,
                totalProfit: 0,
                totalLoss: 0,
                profits: []
            };
        }
        
        const pl = trade.profitLoss || 0;
        stockData[stock].trades += 1;
        stockData[stock].totalPL += pl;
        stockData[stock].profits.push(pl);
        
        if (pl > 0) {
            stockData[stock].wins += 1;
            stockData[stock].totalProfit += pl;
        } else if (pl < 0) {
            stockData[stock].losses += 1;
            stockData[stock].totalLoss += Math.abs(pl);
        }
    });
    
    // Calculate additional metrics
    const stocks = Object.values(stockData).map(stock => {
        const winRate = stock.trades > 0 ? (stock.wins / stock.trades * 100) : 0;
        const avgPL = stock.trades > 0 ? (stock.totalPL / stock.trades) : 0;
        const bestTrade = Math.max(...stock.profits);
        const worstTrade = Math.min(...stock.profits);
        
        return {
            ...stock,
            winRate: winRate,
            avgPL: avgPL,
            bestTrade: bestTrade,
            worstTrade: worstTrade
        };
    });
    
    console.log(`📊 Analyzed ${stocks.length} unique stocks`);
    return stocks;
}
function sortStocks(stocks, sortBy, order) {
    console.log(`🔀 Sorting stocks by ${sortBy} (${order})`);
    
    return [...stocks].sort((a, b) => {
        let aValue, bValue;
        
        switch(sortBy) {
            case 'stock':
                aValue = a.stock;
                bValue = b.stock;
                return order === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
                
            case 'trades':
                aValue = a.trades;
                bValue = b.trades;
                break;
                
            case 'totalPL':
                aValue = a.totalPL;
                bValue = b.totalPL;
                break;
                
            case 'winRate':
                aValue = a.winRate;
                bValue = b.winRate;
                break;
                
            default:
                aValue = a.totalPL;
                bValue = b.totalPL;
        }
        
        return order === 'asc' ? aValue - bValue : bValue - aValue;
    });
}
function renderStockTable(stocks) {
    console.log('🎨 Rendering stock table with', stocks.length, 'stocks');
    
    const tbody = document.getElementById('stockTableBody');
    if (!tbody) {
        console.error('❌ Stock table body not found');
        return;
    }
    
    if (stocks.length === 0) {
        renderEmptyStockTable();
        return;
    }
    
    let html = '';
    
    stocks.forEach((stock, index) => {
        const isPositive = stock.totalPL >= 0;
        const plClass = isPositive ? 'positive' : 'negative';
        const winRateClass = stock.winRate >= 50 ? 'positive' : 'negative';
        
        html += `
            <tr class="stock-row" data-stock="${stock.stock}">
                <td>
                    <strong>${stock.stock}</strong>
                    ${index === 0 && stock.totalPL > 0 ? ' 👑' : ''}
                    ${index === stocks.length - 1 && stock.totalPL < 0 ? ' ⚠️' : ''}
                </td>
                <td>${stock.trades}</td>
                <td class="${plClass}">${formatCurrency(stock.totalPL)}</td>
                <td class="${winRateClass}">${stock.winRate.toFixed(1)}%</td>
                <td>
                    <button class="stock-action-btn view-stock" data-stock="${stock.stock}">
                        View
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    // Add event listeners untuk view buttons
    document.querySelectorAll('.view-stock').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const stock = this.dataset.stock;
            console.log('👁️ View stock details:', stock);
            viewStockDetails(stock);
        });
    });
    
    // Add click event untuk seluruh row
    document.querySelectorAll('.stock-row').forEach(row => {
        row.addEventListener('click', function() {
            const stock = this.dataset.stock;
            console.log('📊 Stock row clicked:', stock);
            filterByStock(stock);
        });
    });
    
    console.log('✅ Stock table rendered');
}
function renderEmptyStockTable() {
    console.log('📭 Rendering empty stock table');
    
    const tbody = document.getElementById('stockTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = `
        <tr class="empty-row">
            <td colspan="5" style="text-align: center; padding: 40px;">
                <div style="font-size: 48px; margin-bottom: 10px;">📭</div>
                <h4 style="color: #7f8c8d; margin-bottom: 10px;">No Trading Data</h4>
                <p style="color: #95a5a6;">Start trading to see stock performance analysis</p>
            </td>
        </tr>
    `;
}
function updateTableSummary(displayedStocks, allStocks) {
    console.log('📝 Updating table summary');
    
    const summaryEl = document.getElementById('tableSummary');
    const countEl = document.getElementById('stockCount');
    
    if (!summaryEl || !countEl) return;
    
    if (displayedStocks.length === 0) {
        summaryEl.textContent = 'No trading data available';
        countEl.textContent = '0 stocks';
        return;
    }
    
    // Hitung metrics
    const totalPL = displayedStocks.reduce((sum, stock) => sum + stock.totalPL, 0);
    const avgWinRate = displayedStocks.reduce((sum, stock) => sum + stock.winRate, 0) / displayedStocks.length;
    const bestStock = displayedStocks[0]; // Already sorted
    
    let summaryText = `Top ${displayedStocks.length} stocks by ${stockTableState.sortBy}`;
    
    if (stockTableState.sortBy === 'totalPL' && bestStock) {
        summaryText += ` | Best: ${bestStock.stock} (${formatCurrency(bestStock.totalPL)})`;
    }
    
    summaryEl.textContent = summaryText;
    countEl.textContent = `${allStocks.length} total stocks`;
}
function updateSortIcons() {
    console.log('🎯 Updating sort icons');
    
    document.querySelectorAll('#stockPerformanceTable th.sortable').forEach(th => {
        const sortIcon = th.querySelector('.sort-icon');
        if (!sortIcon) return;
        
        // Reset semua
        th.classList.remove('sort-asc', 'sort-desc');
        sortIcon.textContent = '↕️';
        
        // Set active sort
        if (th.dataset.sort === stockTableState.sortBy) {
            th.classList.add(`sort-${stockTableState.sortOrder}`);
            sortIcon.textContent = stockTableState.sortOrder === 'asc' ? '↑' : '↓';
        }
    });
}
function viewStockDetails(stock) {
    console.log('🔍 Viewing stock details:', stock);
    
    // Filter data untuk stock ini
    const data = dashboardState.currentFilteredData.length > 0 
        ? dashboardState.currentFilteredData 
        : tradingData;
    
    const stockData = data.filter(item => item.kodeSaham === stock);
    
    if (stockData.length === 0) {
        showNotification('warning', '⚠️ No Data', `No trading data found for ${stock}`, true);
        return;
    }
    
    // Tampilkan modal atau navigate ke report dengan filter
    const stockPerformance = analyzeStockPerformance(stockData)[0];
    
    let message = `📊 ${stock} Performance\n\n`;
    message += `Total Trades: ${stockPerformance.trades}\n`;
    message += `Win Rate: ${stockPerformance.winRate.toFixed(1)}%\n`;
    message += `Total P/L: ${formatCurrency(stockPerformance.totalPL)}\n`;
    message += `Avg P/L per Trade: ${formatCurrency(stockPerformance.avgPL)}\n`;
    message += `Best Trade: ${formatCurrency(stockPerformance.bestTrade)}\n`;
    message += `Worst Trade: ${formatCurrency(stockPerformance.worstTrade)}\n\n`;
    
    if (stockPerformance.totalProfit > 0) {
        message += `Total Profit: ${formatCurrency(stockPerformance.totalProfit)}\n`;
    }
    if (stockPerformance.totalLoss > 0) {
        message += `Total Loss: ${formatCurrency(-stockPerformance.totalLoss)}\n`;
    }
    
    showNotification('info', `📈 ${stock} Analysis`, message, false);
}
function filterByStock(stock) {
    console.log('🎯 Filtering by stock:', stock);
    
    // Navigate ke Report tab dengan filter stock
    showSection('report');
    
    // Set filter value
    setTimeout(() => {
        const filterInput = document.getElementById('filterSaham');
        if (filterInput) {
            filterInput.value = stock;
            applyFilters();
        }
        
        showNotification('info', '🔍 Filter Applied', 
            `Showing all trades for ${stock} in Report section.`, true);
    }, 300);
}
function exportStockTable() {
    console.log('💾 Exporting stock table');
    
    if (stockTableState.currentData.length === 0) {
        showNotification('warning', '⚠️ No Data', 'No stock data to export', true);
        return;
    }
    
    // Create CSV content
    let csv = 'Stock,Trades,Total P/L,Win Rate,Avg P/L,Best Trade,Worst Trade\n';
    
    stockTableState.currentData.forEach(stock => {
        csv += `"${stock.stock}",`;
        csv += `${stock.trades},`;
        csv += `${stock.totalPL},`;
        csv += `${stock.winRate.toFixed(2)},`;
        csv += `${stock.avgPL.toFixed(0)},`;
        csv += `${stock.bestTrade},`;
        csv += `${stock.worstTrade}\n`;
    });
    
    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stock-performance-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('✅ Stock table exported');
    showNotification('success', '✅ Exported', 'Stock performance data exported as CSV', true);
}
// Insights Functions
function setupInsightsPanel() {
    console.log('💡 Setting up insights panel');
    
    // Refresh insights button
    document.getElementById('refreshInsights')?.addEventListener('click', function() {
        console.log('🔄 Refreshing insights');
        generateInsights();
    });
    
    // Initial generation
    setTimeout(() => {
        generateInsights();
    }, 1500);
    
    console.log('✅ Insights panel setup complete');
}
function generateInsights() {
    console.log('🧠 Generating insights');
    
    const data = dashboardState.currentFilteredData.length > 0 
        ? dashboardState.currentFilteredData 
        : tradingData;
    
    if (!data || data.length === 0) {
        renderEmptyInsights();
        return;
    }
    
    const insights = analyzeForInsights(data);
    renderInsights(insights);
    
    console.log('✅ Insights generated');
}
function analyzeForInsights(data) {
    console.log('🔍 Analyzing data for insights from', data.length, 'trades');
    
    if (data.length === 0) {
        return {
            performance: ['No trading data available'],
            patterns: ['Start trading to get insights'],
            risks: ['No risk data available']
        };
    }
    
    // Hitung basic metrics
    const totalPL = data.reduce((sum, item) => sum + (item.profitLoss || 0), 0);
    const totalTrades = data.length;
    const winningTrades = data.filter(item => (item.profitLoss || 0) > 0).length;
    const losingTrades = data.filter(item => (item.profitLoss || 0) < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0;
    
    // Analyze by day
    const dailyData = {};
    data.forEach(item => {
        if (!item.tanggalMasuk) return;
        const date = new Date(item.tanggalMasuk);
        const day = date.getDay(); // 0 = Sunday, 6 = Saturday
        
        if (!dailyData[day]) {
            dailyData[day] = { count: 0, totalPL: 0 };
        }
        dailyData[day].count += 1;
        dailyData[day].totalPL += item.profitLoss || 0;
    });
    
    // Find best/worst day
    let bestDay = null;
    let worstDay = null;
    let highestAvgPL = -Infinity;
    let lowestAvgPL = Infinity;
    
    Object.entries(dailyData).forEach(([day, info]) => {
        const avgPL = info.count > 0 ? info.totalPL / info.count : 0;
        if (avgPL > highestAvgPL) {
            highestAvgPL = avgPL;
            bestDay = parseInt(day);
        }
        if (avgPL < lowestAvgPL) {
            lowestAvgPL = avgPL;
            worstDay = parseInt(day);
        }
    });
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Analyze stock concentration
    const stockData = {};
    data.forEach(item => {
        const stock = item.kodeSaham || 'UNKNOWN';
        if (!stockData[stock]) {
            stockData[stock] = { count: 0, totalPL: 0 };
        }
        stockData[stock].count += 1;
        stockData[stock].totalPL += item.profitLoss || 0;
    });
    
    // Sort stocks by total PL
    const sortedStocks = Object.entries(stockData)
        .sort(([,a], [,b]) => b.totalPL - a.totalPL);
    
    const topStocks = sortedStocks.slice(0, 3);
    const topStocksPL = topStocks.reduce((sum, [,data]) => sum + data.totalPL, 0);
    const topStocksPercentage = totalPL !== 0 ? (topStocksPL / totalPL * 100) : 0;
    
    // Find best/worst trade
    const bestTrade = Math.max(...data.map(item => item.profitLoss || 0));
    const worstTrade = Math.min(...data.map(item => item.profitLoss || 0));
    
    // Analyze profit/loss ratio
    const profitableTrades = data.filter(item => (item.profitLoss || 0) > 0);
    const losingTradesData = data.filter(item => (item.profitLoss || 0) < 0);
    
    const avgWin = profitableTrades.length > 0 
        ? profitableTrades.reduce((sum, item) => sum + (item.profitLoss || 0), 0) / profitableTrades.length 
        : 0;
    const avgLoss = losingTradesData.length > 0 
        ? losingTradesData.reduce((sum, item) => sum + Math.abs(item.profitLoss || 0), 0) / losingTradesData.length 
        : 0;
    
    const profitLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? '∞' : 0;
    
    // Generate insights
    const insights = {
        performance: [],
        patterns: [],
        risks: []
    };
    
    // Performance insights
    if (totalPL > 0) {
        insights.performance.push(`✅ Net profit: ${formatCurrency(totalPL)} from ${totalTrades} trades`);
        insights.performance.push(`🎯 Win rate: ${winRate.toFixed(1)}% (${winningTrades}W/${losingTrades}L)`);
    } else if (totalPL < 0) {
        insights.performance.push(`⚠️ Net loss: ${formatCurrency(totalPL)} from ${totalTrades} trades`);
        insights.performance.push(`🎯 Win rate: ${winRate.toFixed(1)}% (${winningTrades}W/${losingTrades}L)`);
    } else {
        insights.performance.push(`📊 Break even: ${totalTrades} trades with no net P/L`);
    }
    
    if (bestTrade > 0) {
        insights.performance.push(`🏆 Best trade: ${formatCurrency(bestTrade)}`);
    }
    if (worstTrade < 0) {
        insights.performance.push(`💥 Worst trade: ${formatCurrency(worstTrade)}`);
    }
    
    // Pattern insights
    if (bestDay !== null && dailyData[bestDay].count >= 2) {
        insights.patterns.push(`📈 Best performing day: ${dayNames[bestDay]} (avg ${formatCurrency(dailyData[bestDay].totalPL / dailyData[bestDay].count)}/trade)`);
    }
    
    if (worstDay !== null && dailyData[worstDay].count >= 2) {
        insights.patterns.push(`📉 Worst performing day: ${dayNames[worstDay]} (avg ${formatCurrency(dailyData[worstDay].totalPL / dailyData[worstDay].count)}/trade)`);
    }
    
    if (topStocks.length > 0 && topStocksPercentage > 50) {
        insights.patterns.push(`🎯 Top ${topStocks.length} stocks contributed ${topStocksPercentage.toFixed(0)}% of total P/L`);
    }
    
    if (profitLossRatio > 1.5) {
        insights.patterns.push(`💰 Avg win (${formatCurrency(avgWin)}) is ${profitLossRatio.toFixed(1)}× larger than avg loss`);
    } else if (profitLossRatio < 1 && profitLossRatio > 0) {
        insights.patterns.push(`⚖️ Avg win (${formatCurrency(avgWin)}) is ${profitLossRatio.toFixed(1)}× of avg loss - consider risk management`);
    }
    
    // Risk insights
    if (avgLoss > avgWin * 1.5 && avgLoss > 0) {
        insights.risks.push(`⚠️ Average loss (${formatCurrency(avgLoss)}) is ${(avgLoss/avgWin).toFixed(1)}× larger than average win`);
    }
    
    if (losingTrades > winningTrades * 1.5 && losingTrades > 3) {
        insights.risks.push(`📉 More losing trades (${losingTrades}) than winning trades (${winningTrades})`);
    }
    
    if (Math.abs(worstTrade) > Math.abs(bestTrade) * 2 && worstTrade < 0) {
        insights.risks.push(`💥 Largest loss (${formatCurrency(Math.abs(worstTrade))}) is ${(Math.abs(worstTrade)/bestTrade).toFixed(1)}× larger than biggest win`);
    }
    
    // Add general tips jika insights kurang
    if (insights.performance.length < 2) {
        insights.performance.push('📊 Track more trades for detailed insights');
    }
    
    if (insights.patterns.length < 2) {
        insights.patterns.push('🔍 Trade more consistently to identify patterns');
    }
    
    if (insights.risks.length < 2) {
        insights.risks.push('🎯 Maintain 1:2 risk-reward ratio for better results');
        insights.risks.push('📈 Consider setting stop-loss for risk management');
    }
    
    console.log('📊 Insights analysis complete');
    return insights;
}
function renderInsights(insights) {
    console.log('🎨 Rendering insights');
    
    const performanceEl = document.getElementById('insightPerformance');
    const patternsEl = document.getElementById('insightPatterns');
    const risksEl = document.getElementById('insightRisks');
    
    if (!performanceEl || !patternsEl || !risksEl) {
        console.error('❌ Insight elements not found');
        return;
    }
    
    // Render performance insights
    performanceEl.innerHTML = insights.performance.map(item => 
        `<div class="insight-item ${item.includes('✅') ? 'positive' : item.includes('⚠️') ? 'negative' : ''}">${item}</div>`
    ).join('');
    
    // Render pattern insights
    patternsEl.innerHTML = insights.patterns.map(item => 
        `<div class="insight-item ${item.includes('📈') ? 'positive' : item.includes('📉') ? 'negative' : ''}">${item}</div>`
    ).join('');
    
    // Render risk insights
    risksEl.innerHTML = insights.risks.map(item => 
        `<div class="insight-item warning">${item}</div>`
    ).join('');
    
    console.log('✅ Insights rendered');
}
function renderEmptyInsights() {
    console.log('📭 Rendering empty insights');
    
    const performanceEl = document.getElementById('insightPerformance');
    const patternsEl = document.getElementById('insightPatterns');
    const risksEl = document.getElementById('insightRisks');
    
    if (!performanceEl || !patternsEl || !risksEl) return;
    
    performanceEl.innerHTML = '<div class="insight-item">No trading data available</div>';
    patternsEl.innerHTML = '<div class="insight-item">Start trading to get insights</div>';
    risksEl.innerHTML = '<div class="insight-item">No risk data available</div>';
}
// Dashboard Actions
function setupDashboardActions() {
    console.log('🔗 Setting up dashboard actions');
    
    // View detailed report
    document.getElementById('viewDetailedReport')?.addEventListener('click', function() {
        console.log('📄 View detailed report clicked');
        navigateToDetailedReport();
    });
    
    // Export dashboard
    document.getElementById('exportDashboard')?.addEventListener('click', function() {
        console.log('📥 Export dashboard clicked');
        exportDashboard();
    });
    
    console.log('✅ Dashboard actions setup complete');
}
function navigateToDetailedReport() {
    console.log('📍 Navigating to detailed report');
    
    // Navigate ke Report section
    showSection('report');
    
    // Apply current filter jika ada
    const state = dashboardState.dateRange;
    if (state.applied && state.startDate && state.endDate) {
        setTimeout(() => {
            const startDate = state.startDate;
            const endDate = state.endDate;
            
            // TODO: Apply filter di Report section
            console.log('🔍 Applying date filter to report:', { startDate, endDate });
            
            showNotification('info', '🔍 Filter Applied', 
                `Date filter (${startDate} to ${endDate}) applied to report.`, true);
        }, 500);
    }
}
function exportDashboard() {
    console.log('💾 Exporting dashboard');
    
    // Create dashboard snapshot
    const snapshot = {
        timestamp: new Date().toISOString(),
        dateRange: dashboardState.dateRange,
        metrics: {
            totalPL: parseFloat(document.getElementById('filteredTotalPL')?.textContent.replace(/[^0-9.-]+/g, '') || 0),
            winRate: parseFloat(document.getElementById('filteredWinRate')?.textContent.replace('%', '') || 0),
            totalTrades: parseInt(document.getElementById('filteredTotalTrades')?.textContent || 0)
        },
        topStocks: stockTableState.currentData,
        insights: getCurrentInsights()
    };
    
    // Create export content
    const exportContent = createDashboardExport(snapshot);
    
    // Download
    const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-export-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('✅ Dashboard exported');
    showNotification('success', '✅ Exported', 'Dashboard data exported successfully', true);
}
function updateAllPhase2Components() {
    console.log('🔄 updateAllPhase2Components called');

     // Debug: Hitung jumlah trading per saham
    const stockSummary = {};
    tradingData.forEach(item => {
        stockSummary[item.kodeSaham] = (stockSummary[item.kodeSaham] || 0) + 1;
    });
    console.log('📊 Stock summary:', stockSummary);

    
    // Update chart
    updateChartBasedOnType();
    updateChartPeriodInfo();
    
    // Update stock table
    // 2. Update stock table
    if (typeof updateStockTable === 'function') {
        updateStockTable();
    } else {
        console.error('❌ updateStockTable function not found!');
    }
    
    // Update insights
    if (typeof generateInsights === 'function') {
        generateInsights();
    }
    
    console.log('✅ All Phase 2 components updated');
}
// ================================
// SECTION 5: DASHBOARD FUNCTIONS
// ================================
// Date Filter Functions
function applyDateFilter() {
    console.log('🚀 applyDateFilter called');
    console.log('Current mode:', dashboardState.dateRange.mode);
    
    const state = dashboardState.dateRange;
    let filteredData = [];
    
    // Validasi: Jika custom mode tapi tanggal kosong, fallback ke quick filter
    if (state.mode === 'custom') {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        if (!startDate || !endDate) {
            console.log('⚠️ Custom mode but dates empty, falling back to quick filter');
            state.mode = 'quick';
            state.quickFilter = state.quickFilter || '30days';
            
            // Update UI
            const quickBtn = document.querySelector(`[data-range="${state.quickFilter}"]`);
            if (quickBtn) {
                document.querySelectorAll('.filter-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                quickBtn.classList.add('active');
            }
            
            highlightQuickFilter();
        }
    }
    
    // Filter data berdasarkan mode
    if (state.mode === 'quick') {
        console.log('🔧 Applying quick filter:', state.quickFilter);
        
        if (state.quickFilter === 'all') {
            filteredData = [...tradingData];
            state.startDate = null;
            state.endDate = null;
        } else {
            const dates = calculateQuickFilterDates(state.quickFilter);
            state.startDate = dates.startDate;
            state.endDate = dates.endDate;
            
            console.log('📅 Quick filter dates:', dates);
            filteredData = filterDataByDateRange(tradingData, dates.startDate, dates.endDate);
        }
        
        // Update UI untuk quick mode
        highlightQuickFilter();
        
    } else if (state.mode === 'custom') {
        console.log('🔧 Applying custom filter');
        
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        if (!startDate || !endDate) {
            showNotification('error', '❌ Data Tidak Lengkap', 
                'Harap pilih tanggal mulai dan tanggal akhir untuk filter custom.', false);
            return;
        }
        
        if (new Date(endDate) < new Date(startDate)) {
            showNotification('error', '❌ Tanggal Tidak Valid', 
                'Tanggal akhir tidak boleh sebelum tanggal mulai.', false);
            return;
        }
        
        state.startDate = startDate;
        state.endDate = endDate;
        filteredData = filterDataByDateRange(tradingData, startDate, endDate);
        
        // Update UI untuk custom mode
        highlightCustomRange(true);
    }
    
    state.applied = true;
    dashboardState.currentFilteredData = filteredData;
    
    console.log(`✅ Applied filter: ${filteredData.length} items filtered`);
    
    // Update UI
    updateFilteredMetrics(filteredData);
    updateFilterStatusDisplay();
    
    // Update charts dengan data terfilter
    updateCharts(filteredData);
    
    // Update comparison jika aktif
    if (dashboardState.comparison.enabled) {
        calculateComparisonData();
    }
    
    // Save state to localStorage
    saveDashboardState();
    
    // Show success notification
    if (filteredData.length > 0) {
        showNotification('success', '✅ Filter Diterapkan', 
            `Menampilkan ${filteredData.length} trading dalam periode terpilih.`, true);
    } else {
        showNotification('warning', '⚠️ Tidak Ada Data', 
            'Tidak ditemukan data trading dalam periode yang dipilih.', true);
    }
}
function resetDateFilter() {
    console.log('🔄 resetDateFilter called');
    
    // Reset state
    dashboardState.dateRange = {
        mode: 'quick',
        quickFilter: '30days',
        startDate: null,
        endDate: null,
        applied: false
    };
    
    dashboardState.currentFilteredData = [...tradingData];
    
    // Reset UI
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const defaultBtn = document.querySelector('[data-range="30days"]');
    if (defaultBtn) {
        defaultBtn.classList.add('active');
    }
    
    // Reset date inputs
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (startDate) {
        startDate.value = '';
        startDate.disabled = false;
        startDate.style.cursor = 'text';
        startDate.style.backgroundColor = '#ffffff';
    }
    
    if (endDate) {
        endDate.value = '';
        endDate.disabled = false;
        endDate.style.cursor = 'text';
        endDate.style.backgroundColor = '#ffffff';
    }
    
    // Reset UI mode
    highlightQuickFilter();
    
    // Update display dengan semua data
    updateFilteredMetrics(tradingData);
    updateFilterStatusDisplay();
    
    // Update charts dengan semua data
    updateCharts(tradingData);
    
    // Reset comparison
    if (dashboardState.comparison.enabled) {
        dashboardState.comparison.previousData = null;
        document.querySelectorAll('.metric-trend').forEach(el => {
            el.textContent = '';
            el.className = 'metric-trend';
        });
    }
    
    // Save state
    saveDashboardState();
    
    showNotification('info', '🔄 Filter Direset', 'Menampilkan semua data trading.', true);
}
function initializeDatePickers() {
    console.log('📅 initializeDatePickers called');
    
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    if (startDateInput) {
        // Set default value (30 days ago)
        const defaultStart = formatDateToString(thirtyDaysAgo);
        startDateInput.value = defaultStart;
        startDateInput.max = formatDateToString(today);
        
        // ENABLE input
        startDateInput.disabled = false;
        startDateInput.style.cursor = 'text';
        startDateInput.style.backgroundColor = '#ffffff';
        
        // Auto-apply ketika user pilih tanggal
        startDateInput.addEventListener('change', function() {
            console.log('📅 Start date changed to:', this.value);
            
            // Jika user pilih tanggal, auto-switch ke custom mode
            if (dashboardState.dateRange.mode === 'quick') {
                dashboardState.dateRange.mode = 'custom';
                highlightCustomRange(true);
            }
        });
    }
    
    if (endDateInput) {
        // Set default value (today)
        const defaultEnd = formatDateToString(today);
        endDateInput.value = defaultEnd;
        endDateInput.max = formatDateToString(today);
        
        // ENABLE input
        endDateInput.disabled = false;
        endDateInput.style.cursor = 'text';
        endDateInput.style.backgroundColor = '#ffffff';
        
        // Update min berdasarkan start date
        if (startDateInput) {
            endDateInput.min = startDateInput.value;
            
            // Auto-update min ketika start date berubah
            startDateInput.addEventListener('change', function() {
                endDateInput.min = this.value;
                if (new Date(endDateInput.value) < new Date(this.value)) {
                    endDateInput.value = this.value;
                }
            });
        }
        
        endDateInput.addEventListener('change', function() {
            console.log('📅 End date changed to:', this.value);
            
            // Jika user pilih tanggal, auto-switch ke custom mode
            if (dashboardState.dateRange.mode === 'quick') {
                dashboardState.dateRange.mode = 'custom';
                highlightCustomRange(true);
            }
        });
    }
    
    console.log('✅ Date pickers initialized and ENABLED');
}
function setupDashboardListeners() {
    console.log('🔧 Setting up dashboard listeners');
    
    // Quick filter buttons
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            console.log('🎯 Quick filter clicked:', this.dataset.range);
            
            // Update active state
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Update state
            dashboardState.dateRange.mode = 'quick';
            dashboardState.dateRange.quickFilter = this.dataset.range;
            
            // ENABLE INPUTS (FIX: Jangan disable)
            enableDateInputs();
            
            // Apply filter
            applyDateFilter();
        });
    });
    
    // Custom range inputs focus
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    if (startDateInput) {
        startDateInput.addEventListener('focus', function() {
            console.log('🎯 Custom range start date selected');
            
            // Update state to custom
            dashboardState.dateRange.mode = 'custom';
            
            // Update UI untuk custom mode
            highlightCustomRange(true);
            
            // ENABLE inputs
            enableDateInputs();
        });
        
        startDateInput.addEventListener('change', function() {
            // Auto-switch to custom mode ketika user pilih tanggal
            if (dashboardState.dateRange.mode === 'quick') {
                dashboardState.dateRange.mode = 'custom';
                highlightCustomRange(true);
            }
        });
    }
    
    if (endDateInput) {
        endDateInput.addEventListener('focus', function() {
            console.log('🎯 Custom range end date selected');
            
            // Update state to custom
            dashboardState.dateRange.mode = 'custom';
            
            // Update UI untuk custom mode
            highlightCustomRange(true);
            
            // ENABLE inputs
            enableDateInputs();
        });
        
        endDateInput.addEventListener('change', function() {
            // Auto-switch to custom mode
            if (dashboardState.dateRange.mode === 'quick') {
                dashboardState.dateRange.mode = 'custom';
                highlightCustomRange(true);
            }
        });
    }
    
    // Apply filter button
    document.getElementById('applyDateFilter')?.addEventListener('click', function() {
        console.log('🎯 Apply filter button clicked');
        
        // Pastikan mode sesuai dengan input yang aktif
        if (startDateInput?.value || endDateInput?.value) {
            dashboardState.dateRange.mode = 'custom';
            highlightCustomRange(true);
        }
        
        applyDateFilter();
    });
    
    // Reset filter button
    document.getElementById('resetDateFilter')?.addEventListener('click', function() {
        console.log('🎯 Reset filter button clicked');
        resetDateFilter();
    });
    
    // Comparison toggle
    const compareToggle = document.getElementById('compareToggle');
    if (compareToggle) {
        compareToggle.addEventListener('change', function() {
            console.log('🎯 Comparison toggle changed:', this.checked);
            toggleComparison(this.checked);
        });
    }
    
    console.log('✅ Dashboard listeners setup complete');
}
function enableDateInputs() {
    console.log('🔓 Enabling date inputs');
    
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (startDate) {
        startDate.disabled = false;
        startDate.style.cursor = 'text';
        startDate.style.backgroundColor = '#ffffff';
        startDate.style.opacity = '1';
    }
    
    if (endDate) {
        endDate.disabled = false;
        endDate.style.cursor = 'text';
        endDate.style.backgroundColor = '#ffffff';
        endDate.style.opacity = '1';
    }
}
function highlightCustomRange(highlight = true) {
    const customRange = document.querySelector('.custom-range');
    if (!customRange) return;
    
    if (highlight) {
        // Visual feedback untuk custom mode
        customRange.style.backgroundColor = '#e8f4fd';
        customRange.style.border = '2px solid #3498db';
        customRange.style.boxShadow = '0 0 0 2px rgba(52, 152, 219, 0.2)';
        
        // Remove active dari quick filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    } else {
        // Reset ke default
        customRange.style.backgroundColor = '#f8f9fa';
        customRange.style.border = '1px solid #e1e5e9';
        customRange.style.boxShadow = 'none';
    }
}
function highlightQuickFilter() {
    const customRange = document.querySelector('.custom-range');
    if (customRange) {
        customRange.style.backgroundColor = '#f8f9fa';
        customRange.style.border = '1px solid #e1e5e9';
        customRange.style.boxShadow = 'none';
    }
}
function updateFilteredMetrics(filteredData) {
    console.log('📊 updateFilteredMetrics called with', filteredData?.length || 0, 'items');
    
    // Debug: Check what data we're getting
    console.log('🔍 First 3 items sample:', filteredData?.slice(0, 3));
    
    // Debug: Check if elements exist BEFORE trying to update
    console.log('🔍 Checking elements before update:');
    const elementIds = ['filteredTotalPL', 'filteredWinRate', 'filteredTotalTrades', 
                       'filteredAvgProfit', 'filteredMaxProfit', 'filteredMaxLoss'];
    
    elementIds.forEach(id => {
        const el = document.getElementById(id);
        console.log(`   ${id}:`, el ? 'FOUND' : 'NOT FOUND');
    });
    
    if (!filteredData || filteredData.length === 0) {
        console.log('ℹ️ No data to display');
        
        // Reset semua metrics DENGAN ERROR HANDLING
        safelyUpdateElement('filteredTotalPL', 'Rp 0', 'metric-value');
        safelyUpdateElement('filteredWinRate', '0%', 'metric-value');
        safelyUpdateElement('filteredTotalTrades', '0', 'metric-value');
        safelyUpdateElement('filteredAvgProfit', 'Rp 0', 'metric-value');
        safelyUpdateElement('filteredMaxProfit', 'Rp 0', 'metric-value');
        safelyUpdateElement('filteredMaxLoss', 'Rp 0', 'metric-value');
        
        // Reset trends
        document.querySelectorAll('.metric-trend').forEach(el => {
            el.textContent = '';
            el.className = 'metric-trend';
        });
        
        return;
    }
    
    // Hitung metrics DENGAN VALIDASI
    let totalPL = 0;
    let validItems = 0;
    
    filteredData.forEach(item => {
        const pl = parseFloat(item.profitLoss);
        if (!isNaN(pl)) {
            totalPL += pl;
            validItems++;
        } else {
            console.warn('⚠️ Invalid profitLoss:', item.profitLoss, 'in item:', item);
        }
    });
    
    const totalTrades = validItems;
    const winningTrades = filteredData.filter(item => {
        const pl = parseFloat(item.profitLoss);
        return !isNaN(pl) && pl > 0;
    }).length;
    
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0;
    const avgProfit = totalTrades > 0 ? (totalPL / totalTrades) : 0;
    
    // Temukan max profit dan max loss
    let maxProfit = 0;
    let maxLoss = 0;
    
    filteredData.forEach(item => {
        const pl = parseFloat(item.profitLoss);
        if (!isNaN(pl)) {
            if (pl > maxProfit) maxProfit = pl;
            if (pl < maxLoss) maxLoss = pl;
        }
    });
    
    console.log('📈 Calculated metrics:', {
        totalPL, 
        totalTrades: `${validItems}/${filteredData.length} valid items`,
        winningTrades, 
        winRate, 
        avgProfit, 
        maxProfit, 
        maxLoss
    });
    
    // Update display DENGAN SAFE FUNCTION
    safelyUpdateElement('filteredTotalPL', formatCurrency(totalPL), 
                       `metric-value ${totalPL >= 0 ? 'positive' : 'negative'}`);
    
    safelyUpdateElement('filteredWinRate', `${winRate.toFixed(1)}%`, 'metric-value');
    safelyUpdateElement('filteredTotalTrades', totalTrades.toString(), 'metric-value');
    safelyUpdateElement('filteredAvgProfit', formatCurrency(avgProfit), 'metric-value');
    safelyUpdateElement('filteredMaxProfit', formatCurrency(maxProfit), 'metric-value positive');
    safelyUpdateElement('filteredMaxLoss', formatCurrency(maxLoss), 'metric-value negative');
    
    // Update comparison jika aktif
    if (dashboardState.comparison.enabled && dashboardState.comparison.previousData) {
        updateComparisonMetrics(filteredData, dashboardState.comparison.previousData);
    }

    // Update Phase 2 components
    if (typeof updateAllPhase2Components === 'function') {
        setTimeout(() => {
            updateAllPhase2Components();
        }, 100);
    }
}


// ================================
// SECTION 6: POSITION FUNCTIONS
// ================================
// Position Management
function rebuildPositionsFromData() {
    console.log('🔄 Rebuilding positions from PositionData...');
    
    const positions = {};
    
    // PHASE 1: Process semua ENTRIES terlebih dahulu
    tradingData.forEach(trade => {
        if (trade.positionData && trade.positionData.positionId && trade.positionData.transactionType === 'entry') {
            const positionId = trade.positionData.positionId;
            
            if (!positions[positionId]) {
                positions[positionId] = {
                    id: positionId,
                    kodeSaham: trade.kodeSaham,
                    status: 'open',
                    entries: [],
                    exits: [], // ✅ BARU: Track exits
                    totalLot: 0,
                    totalFeeBuy: 0,
                    averagePrice: 0,
                    totalInvestment: 0,
                    remainingLot: 0 // ✅ Initialize
                };
            }
            
            // Process entry
            positions[positionId].entries.push({
                id: trade.id,
                tanggal: trade.tanggalMasuk,
                lot: trade.lot,
                harga: trade.hargaMasuk,
                fee: trade.feeBuy
            });
            
            positions[positionId].totalLot += trade.lot;
            positions[positionId].totalFeeBuy += trade.feeBuy;
            positions[positionId].remainingLot += trade.lot; // ✅ Tambah remaining lot
        }
    });
    
    // PHASE 2: Process semua EXITS
    tradingData.forEach(trade => {
        if (trade.positionData && trade.positionData.positionId && trade.positionData.transactionType === 'exit') {
            const positionId = trade.positionData.positionId;
            
            if (!positions[positionId]) {
                console.warn(`❌ Exit transaction for unknown position: ${positionId}`);
                return;
            }
            
            const exitLot = trade.lot;
            
            // Process exit
            positions[positionId].exits.push({
                id: trade.id,
                tanggal: trade.tanggalKeluar,
                lot: exitLot,
                hargaKeluar: trade.hargaKeluar,
                feeSell: trade.feeSell,
                profitLoss: trade.profitLoss
            });
            
            // ✅ KURANGI remainingLot
            positions[positionId].remainingLot -= exitLot;
            
            // Update status berdasarkan remainingLot
            if (positions[positionId].remainingLot <= 0) {
                positions[positionId].status = 'closed';
                positions[positionId].remainingLot = 0; // Pastikan tidak minus
            } else {
                positions[positionId].status = 'open';
            }
        }
    });
    
    // PHASE 3: Calculate average price untuk semua positions
    Object.values(positions).forEach(position => {
        if (position.entries.length > 0) {
            const totalShares = position.entries.reduce((sum, entry) => 
                sum + (entry.lot * 100 * entry.harga), 0);
            const totalLot = position.entries.reduce((sum, entry) => 
                sum + entry.lot, 0);
            
            position.averagePrice = totalLot > 0 ? 
                Math.round(totalShares / (totalLot * 100)) : 0;
            position.totalInvestment = totalShares + position.totalFeeBuy;
        }
    });
    
    console.log('✅ Rebuilt positions:', Object.keys(positions).length);
    
    // ✅ DEBUG DETAIL: Log semua positions dengan info lengkap
    Object.values(positions).forEach(pos => {
        console.log(`📊 Position: ${pos.id} (${pos.kodeSaham})`, {
            status: pos.status,
            totalLot: pos.totalLot,
            remainingLot: pos.remainingLot,
            entries: pos.entries.length,
            exits: pos.exits.length,
            averagePrice: pos.averagePrice
        });
    });
    
    return positions;
}
function generatePositionId(kodeSaham) {
    return `POS-${kodeSaham}-${Date.now()}`;
}
// Position UI Handlers
function setupPositionTradingListeners() {
    const toggle = document.getElementById('positionModeToggle');
    const positionType = document.getElementById('positionType');
    const existingPositions = document.getElementById('existingPositions');
    
    if (!toggle) return;
    
    // Toggle switch listener
    toggle.addEventListener('change', function() {
        const isPositionMode = this.checked;
        togglePositionMode(isPositionMode);
    });
    
    // Position type change listener
    positionType.addEventListener('change', function() {
        handlePositionTypeChange(this.value);
    });
    
    // Existing positions change listener
    existingPositions.addEventListener('change', function() {
        handlePositionSelection(this.value);
    });
    
    // Real-time preview listeners
    const previewFields = ['hargaMasuk', 'hargaKeluar', 'lot', 'feeBuy', 'feeSell', 'partialLot'];
    previewFields.forEach(field => {
        const element = document.getElementById(field);
        if (element) {
            element.addEventListener('input', updatePositionPreview);
        }
    });
}
function togglePositionMode(isPositionMode) {
    const toggleDesc = document.getElementById('toggleDesc');
    const positionSelection = document.getElementById('positionSelection');
    const tanggalKeluarGroup = document.querySelector('label[for="tanggalKeluar"]').parentElement;
    const hargaKeluarGroup = document.querySelector('label[for="hargaKeluar"]').parentElement;
    const feeSellGroup = document.querySelector('label[for="feeSell"]').parentElement;
    
    // ✅ Reset kodeSaham field ketika ganti mode
    document.getElementById('kodeSaham').value = '';
    document.getElementById('kodeSaham').readOnly = false;
    
    if (isPositionMode) {
        // Mode Posisi Saham
        toggleDesc.textContent = 'Multiple Buy/Sell dalam 1 posisi';
        positionSelection.style.display = 'block';
        
        // Reset form
        document.getElementById('positionType').value = 'new';
        handlePositionTypeChange('new');
        
    } else {
        // Mode Trading Biasa
        toggleDesc.textContent = '1x Buy + 1x Sell dalam 1 trading';
        positionSelection.style.display = 'none';
        
        // Show semua field
        tanggalKeluarGroup.style.display = 'block';
        hargaKeluarGroup.style.display = 'block';
        feeSellGroup.style.display = 'block';
        
        // Hide position-specific elements
        document.getElementById('existingPositionsContainer').style.display = 'none';
        document.getElementById('partialExitContainer').style.display = 'none';
        document.getElementById('positionPreview').style.display = 'none';
    }
}
function handlePositionTypeChange(positionType) {
    const tanggalMasukGroup = document.querySelector('label[for="tanggalMasuk"]').parentElement;
    const tanggalKeluarGroup = document.querySelector('label[for="tanggalKeluar"]').parentElement;
    const hargaMasukGroup = document.querySelector('label[for="hargaMasuk"]').parentElement;
    const hargaKeluarGroup = document.querySelector('label[for="hargaKeluar"]').parentElement;
    const lotGroup = document.querySelector('label[for="lot"]').parentElement;
    const feeBuyGroup = document.querySelector('label[for="feeBuy"]').parentElement;
    const feeSellGroup = document.querySelector('label[for="feeSell"]').parentElement;
    const existingPositionsContainer = document.getElementById('existingPositionsContainer');
    const partialExitContainer = document.getElementById('partialExitContainer');
    
    // Reset semua field ke default
    resetFormFields();
    
    // Update form berdasarkan jenis transaksi
    switch(positionType) {
        case 'new': // Beli - Buat Posisi Baru
            tanggalKeluarGroup.style.display = 'none';
            hargaKeluarGroup.style.display = 'none';
            feeSellGroup.style.display = 'none';
            break;
            
        case 'add': // Beli - Tambah ke Posisi Existing
            tanggalKeluarGroup.style.display = 'none';
            hargaKeluarGroup.style.display = 'none';
            feeSellGroup.style.display = 'none';
            existingPositionsContainer.style.display = 'block';
            populateExistingPositions('open');
            break;
            
        case 'close': // Jual - Tutup Posisi
            tanggalMasukGroup.style.display = 'none';
            hargaMasukGroup.style.display = 'none';
            feeBuyGroup.style.display = 'none';
            existingPositionsContainer.style.display = 'block';
            populateExistingPositions('open');
            break;
            
        case 'partial': // Jual - Partial Exit - ✅ DIPERBAIKI
            tanggalMasukGroup.style.display = 'none';
            hargaMasukGroup.style.display = 'none';
            lotGroup.style.display = 'none';
            feeBuyGroup.style.display = 'none';
            existingPositionsContainer.style.display = 'block';
            partialExitContainer.style.display = 'block';
            populateExistingPositions('open');
            break;
    }
    
    updatePositionPreview();
}
function resetFormFields() {
    const allGroups = [
        document.querySelector('label[for="tanggalMasuk"]').parentElement,
        document.querySelector('label[for="tanggalKeluar"]').parentElement,
        document.querySelector('label[for="hargaMasuk"]').parentElement,
        document.querySelector('label[for="hargaKeluar"]').parentElement,
        document.querySelector('label[for="lot"]').parentElement,
        document.querySelector('label[for="feeBuy"]').parentElement,
        document.querySelector('label[for="feeSell"]').parentElement
    ];
    
    // Tampilkan semua field terlebih dahulu
    allGroups.forEach(group => {
        if (group) group.style.display = 'block';
    });
    
    // Reset nilai field
    document.getElementById('kodeSaham').value = '';
    document.getElementById('kodeSaham').readOnly = false;
    document.getElementById('hargaMasuk').value = '';
    document.getElementById('hargaMasuk').readOnly = false;
    document.getElementById('lot').value = '1'; // ✅ SET DEFAULT 1
    document.getElementById('lot').readOnly = false;
    document.getElementById('hargaKeluar').value = '';
    document.getElementById('feeBuy').value = '';
    document.getElementById('feeSell').value = '';
    
    // Reset partial exit container
    document.getElementById('partialExitContainer').style.display = 'none';
    document.getElementById('partialLot').value = '1'; // ✅ SET DEFAULT 1
}
function populateExistingPositions(status = 'open') {
    const existingPositions = document.getElementById('existingPositions');
    const positionInfo = document.getElementById('positionInfo');
    
    if (!existingPositions) return;
    
    existingPositions.innerHTML = '<option value="">-- Pilih Posisi --</option>';
    positionInfo.style.display = 'none';
    
    // Reset form fields
    document.getElementById('kodeSaham').value = '';
    document.getElementById('kodeSaham').readOnly = false;
    document.getElementById('lot').value = '';
    document.getElementById('lot').readOnly = false;
    
    // Rebuild positions dari trading data
    const positions = rebuildPositionsFromData();
    
    // ✅ FILTER YANG LEBIH AKURAT: 
    // Tampilkan posisi yang status open DAN ada remaining lot > 0
    const availablePositions = Object.values(positions).filter(pos => {
        const hasRemainingLot = pos.remainingLot > 0;
        const isOpenStatus = pos.status === 'open';
        
        console.log(`🔍 Filtering: ${pos.kodeSaham}`, {
            status: pos.status,
            remainingLot: pos.remainingLot,
            hasRemainingLot: hasRemainingLot,
            isOpenStatus: isOpenStatus,
            shouldShow: hasRemainingLot && isOpenStatus
        });
        
        return hasRemainingLot && isOpenStatus;
    });
    
    console.log(`📋 Available positions: ${availablePositions.length}`);
    
    if (availablePositions.length === 0) {
        existingPositions.innerHTML = '<option value="">Tidak ada posisi open</option>';
        
        // ✅ DEBUG: Tampilkan kenapa tidak ada posisi
        const allPositions = Object.values(positions);
        console.log('🔍 All positions debug:', allPositions.map(p => ({
            kodeSaham: p.kodeSaham,
            status: p.status,
            totalLot: p.totalLot,
            remainingLot: p.remainingLot
        })));
        
        return;
    }
    
    availablePositions.forEach(position => {
        const option = document.createElement('option');
        option.value = position.id;
        
        // ✅ TAMPILKAN INFO YANG JELAS: Sisa lot / Total lot
        const lotInfo = position.remainingLot === position.totalLot ? 
            `${position.totalLot} lot` : 
            `${position.remainingLot}/${position.totalLot} lot`;
            
        option.textContent = `${position.kodeSaham} - ${lotInfo} @ ${formatCurrency(position.averagePrice)}`;
        
        option.setAttribute('data-position', JSON.stringify({
            id: position.id,
            kodeSaham: position.kodeSaham,
            averagePrice: position.averagePrice,
            totalLot: position.totalLot,
            remainingLot: position.remainingLot, // ✅ PASTIKAN ini ada
            totalInvestment: position.totalInvestment,
            totalFeeBuy: position.totalFeeBuy,
            entries: position.entries || [],
            exits: position.exits || []
        }));
        
        existingPositions.appendChild(option);
    });
    
    console.log(`✅ Populated ${availablePositions.length} positions to dropdown`);
}
function handlePositionSelection(positionId) {
    const positionInfo = document.getElementById('positionInfo');
    const existingPositions = document.getElementById('existingPositions');
    const partialLotInput = document.getElementById('partialLot');
    const totalAvailableLot = document.getElementById('totalAvailableLot');
    const positionType = document.getElementById('positionType').value;
    
    if (!positionId) {
        positionInfo.style.display = 'none';
        return;
    }
    
    const selectedOption = existingPositions.querySelector(`option[value="${positionId}"]`);
    if (!selectedOption) return;
    
    const position = JSON.parse(selectedOption.getAttribute('data-position'));
    
    // ✅ AUTO-FILL KODE SAHAM
    document.getElementById('kodeSaham').value = position.kodeSaham || '';
    document.getElementById('kodeSaham').readOnly = true;
    
    // ✅ AUTO-FILL HARGA MASUK untuk partial/close exit (harga rata-rata)
    if (positionType === 'partial') {
        document.getElementById('hargaMasuk').value = position.averagePrice || '';
        document.getElementById('hargaMasuk').readOnly = true;
    } else if (positionType === 'close') {
       // Auto-fill LOT dengan remaining lot (readonly)
        document.getElementById('lot').value = position.remainingLot || position.totalLot;
        document.getElementById('lot').readOnly = true;
    }
    
    // Update position info
    positionInfo.innerHTML = `
        <div class="position-info-item">
            <span>Kode Saham:</span>
            <span><strong>${position.kodeSaham}</strong></span>
        </div>
        <div class="position-info-item">
            <span>Harga Rata:</span>
            <span>${formatCurrency(position.averagePrice)}</span>
        </div>
        <div class="position-info-item">
            <span>Total Lot Awal:</span>
            <span>${position.totalLot}</span>
        </div>
        <div class="position-info-item">
            <span>Sisa Lot Saat Ini:</span>
            <span><strong>${position.remainingLot || position.totalLot} lot</strong></span>
        </div>
        <div class="position-info-item">
            <span>Total Investasi:</span>
            <span>${formatCurrency(position.totalInvestment)}</span>
        </div>
        <div class="position-info-item">
            <span>Total Fee Beli:</span>
            <span>${formatCurrency(position.totalFeeBuy)}</span>
        </div>
    `;
    positionInfo.style.display = 'block';
    
    // Update partial exit info
    if (partialLotInput && positionType === 'partial') {
        partialLotInput.max = position.remainingLot || position.totalLot;
        totalAvailableLot.textContent = position.remainingLot || position.totalLot; // ✅ Tampilkan sisa lot
        partialLotInput.value = Math.min(1, position.remainingLot || position.totalLot);
    }
    updatePositionPreview();
}
// Position Form Handlers
function updatePositionPreview() {
    const preview = document.getElementById('positionPreview');
    const positionType = document.getElementById('positionType')?.value;
    const isPositionMode = document.getElementById('positionModeToggle')?.checked;
    
    if (!isPositionMode || !positionType) {
        preview.style.display = 'none';
        return;
    }
    
    let previewHTML = '<h4>Preview:</h4>';
    
    switch(positionType) {
        case 'new':
            previewHTML += getNewPositionPreview();
            break;
        case 'add':
            previewHTML += getAddPositionPreview();
            break;
        case 'close':
        case 'partial':
            previewHTML += getExitPositionPreview();
            break;
    }
    
    preview.innerHTML = previewHTML;
    preview.style.display = 'block';
}
function getNewPositionPreview() {
    const kodeSaham = document.getElementById('kodeSaham').value || '?';
    const lot = parseInt(document.getElementById('lot').value) || 0;
    const hargaMasuk = parseFloat(document.getElementById('hargaMasuk').value) || 0;
    
    return `
        <div class="preview-item">
            <span class="preview-label">Posisi Baru:</span>
            <span class="preview-value">${kodeSaham} - ${lot} lot</span>
        </div>
        <div class="preview-item">
            <span class="preview-label">Harga Beli:</span>
            <span class="preview-value">${formatCurrency(hargaMasuk)}</span>
        </div>
    `;
}
function getAddPositionPreview() {
    // Implementasi preview untuk average down
    const selectedPosition = getSelectedPosition();
    if (!selectedPosition) return '<div class="preview-item">Pilih posisi terlebih dahulu</div>';
    
    const lot = parseInt(document.getElementById('lot').value) || 0;
    const hargaMasuk = parseFloat(document.getElementById('hargaMasuk').value) || 0;
    
    // Calculate new average
    const newTotalLot = selectedPosition.totalLot + lot;
    const newTotalValue = (selectedPosition.totalLot * 100 * selectedPosition.averagePrice) + (lot * 100 * hargaMasuk);
    const newAveragePrice = newTotalValue / (newTotalLot * 100);
    
    return `
        <div class="preview-item">
            <span class="preview-label">Posisi Saat Ini:</span>
            <span class="preview-value">${selectedPosition.totalLot} lot @ ${formatCurrency(selectedPosition.averagePrice)}</span>
        </div>
        <div class="preview-item">
            <span class="preview-label">Setelah Average:</span>
            <span class="preview-value">${newTotalLot} lot @ ${formatCurrency(Math.round(newAveragePrice))}</span>
        </div>
    `;
}
function getExitPositionPreview() {
    const selectedPosition = getSelectedPosition();
    if (!selectedPosition) return '<div class="preview-item">Pilih posisi terlebih dahulu</div>';
    
    const hargaKeluar = parseFloat(document.getElementById('hargaKeluar').value) || 0;
    const positionType = document.getElementById('positionType').value;
    
    let exitLot;
    if (positionType === 'partial') {
        exitLot = parseInt(document.getElementById('partialLot').value) || 0;
    } else {
        exitLot = selectedPosition.totalLot;
    }

     // ✅ HITUNG SISA LOT SETELAH EXIT
    const sisaLotSetelahExit = (selectedPosition.remainingLot || selectedPosition.totalLot) - exitLot;
    
    // Calculate profit/loss
    const profitLoss = calculatePositionProfitLoss(selectedPosition, hargaKeluar, exitLot);
    
    let previewHTML = `
        <div class="preview-item">
            <span class="preview-label">Jenis Exit:</span>
            <span class="preview-value">${positionType === 'partial' ? 'Partial Exit' : 'Full Exit'}</span>
        </div>
        <div class="preview-item">
            <span class="preview-label">Lot yang Dijual:</span>
            <span class="preview-value">${exitLot} lot</span>
        </div>
        <div class="preview-item">
            <span class="preview-label">Sisa Lot Setelah Exit:</span>
            <span class="preview-value"><strong>${sisaLotSetelahExit} lot</strong></span>
        </div>
        <div class="preview-item">
            <span class="preview-label">Harga Rata Beli:</span>
            <span class="preview-value">${formatCurrency(selectedPosition.averagePrice)}</span>
        </div>
    `;

    if (hargaKeluar > 0) {
        previewHTML += `
            <div class="preview-item">
                <span class="preview-label">Harga Jual:</span>
                <span class="preview-value">${formatCurrency(hargaKeluar)}</span>
            </div>
            <div class="preview-item">
                <span class="preview-label">Estimasi P/L:</span>
                <span class="preview-value ${profitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(profitLoss)}</span>
            </div>
        `;
    }
    
    return previewHTML;
}
// Position Transaction Handlers
async function handlePositionFormSubmit(positionType) {
    console.log('🚀 SUBMITTING POSITION FORM:', positionType);
    
    // Validasi berdasarkan jenis transaksi
    const validation = validatePositionForm(positionType);
    console.log('📋 VALIDATION RESULT:', validation);
    
    if (!validation.isValid) {
        console.log('❌ VALIDATION FAILED:', validation.message);
        showNotification('error', '❌ Validasi Gagal', validation.message, false);
        return;
    }
    
    // Tampilkan loading dan disable form
    showLoading('Menyimpan data posisi...');
    disableForm();
    
    try {
        let formData;
        
        switch(positionType) {
            case 'new':
                formData = await handleNewPosition();
                break;
            case 'add':
                formData = await handleAddToPosition();
                break;
            case 'close':
                formData = await handleClosePosition();
                break;
            case 'partial':
                formData = await handlePartialExit();
                break;
        }
        
        if (!formData) {
            throw new Error('Gagal membuat data position');
        }
        
        console.log('Final position data to save:', formData);
        
        // ✅ PERBAIKAN: GUNAKAN SMART SAVE SYSTEM untuk position data
        const saveResult = await smartSavePositionData(formData);
        
        if (saveResult.success) {
            let successMessage;
            
            switch(positionType) {
                case 'new':
                    successMessage = `✅ Posisi baru berhasil ${saveResult.mode === 'offline' ? 'disimpan lokal' : 'dibuat'}!\n\nKode Saham: ${formData.kodeSaham}\nLot: ${formData.lot}\nHarga Rata: ${formatCurrency(formData.hargaMasuk)}`;
                    break;
                case 'add':
                    successMessage = `✅ Berhasil menambah ke posisi existing ${saveResult.mode === 'offline' ? '(disimpan lokal)' : ''}!\n\nKode Saham: ${formData.kodeSaham}\nTotal Lot: ${formData.positionData.currentTotalLot}\nHarga Rata Baru: ${formatCurrency(formData.positionData.currentAvgPrice)}`;
                    break;
                case 'close':
                    successMessage = `✅ Posisi berhasil ditutup ${saveResult.mode === 'offline' ? '(disimpan lokal)' : ''}!\n\nKode Saham: ${formData.kodeSaham}\nProfit/Loss: ${formatCurrency(formData.profitLoss)}`;
                    break;
                case 'partial':
                    successMessage = `✅ Partial exit berhasil ${saveResult.mode === 'offline' ? '(disimpan lokal)' : ''}!\n\nKode Saham: ${formData.kodeSaham}\nLot Terjual: ${formData.lot}\nRealized P/L: ${formatCurrency(formData.profitLoss)}`;
                    break;
            }
            
            if (saveResult.mode === 'offline') {
                successMessage += `\n\n📋 ID Pending: ${saveResult.pendingId}`;
            }
            
            // Reset form dan kembali ke mode biasa
            document.getElementById('tradingForm').reset();
            document.getElementById('lot').value = 1;
            document.getElementById('positionModeToggle').checked = false;
            const toggleEvent = new Event('change');
            document.getElementById('positionModeToggle').dispatchEvent(toggleEvent);
            
            // Update tampilan
            updateHomeSummary();
            displayTradingData();
            
            showNotification('success', '✅ Berhasil', successMessage, false);
            
        } else {
            throw new Error('Gagal menyimpan data position');
        }
        
    } catch (error) {
        console.error('Error in position form submission:', error);
        showNotification('error', '❌ Error Sistem', 'Terjadi error saat menyimpan data posisi:\n\n' + error.message, false);
    } finally {
        // Sembunyikan loading dan enable form
        hideLoading();
        enableForm();
    }
}
async function handleRegularFormSubmit() {
    console.log('🔄 Handling regular form submit with smart save...');
    
    // Validasi form
    const tanggalMasuk = document.getElementById('tanggalMasuk').value;
    const tanggalKeluar = document.getElementById('tanggalKeluar').value;
    const kodeSaham = document.getElementById('kodeSaham').value;
    const hargaMasuk = document.getElementById('hargaMasuk').value;
    const hargaKeluar = document.getElementById('hargaKeluar').value;
    const lot = document.getElementById('lot').value;
    
    if (!tanggalMasuk || !kodeSaham || !hargaMasuk || !lot) {
        showNotification('error', '❌ Data Tidak Lengkap', 'Harap isi semua field yang wajib!\n\n• Tanggal Masuk\n• Kode Saham\n• Harga Masuk\n• Jumlah LOT', false);
    return;
    }
    
    if (tanggalKeluar && tanggalKeluar < tanggalMasuk) {
        showNotification('error', '❌ Tanggal Tidak Valid', 'Tanggal keluar tidak boleh sebelum tanggal masuk!\n\nSilakan periksa kembali tanggal yang dimasukkan.', false);
    return;
    }
    
    if (parseInt(lot) < 1) {
        showNotification('error', '❌ Jumlah LOT Invalid', 'Jumlah LOT minimal 1!\n\nSilakan masukkan jumlah LOT yang valid.', false);
    return;
    }
    
    // Tampilkan loading
    showLoading('Menyimpan data...');
    disableForm();
    
    try {
        // ✅ GUNAKAN SMART SAVE SYSTEM
        const saveResult = await smartSaveData();
        
        if (saveResult.success) {
            console.log('✅ Form submit successful:', saveResult);
            
            // Reset form
            document.getElementById('tradingForm').reset();
            document.getElementById('lot').value = 1;
            
        } else {
            console.error('❌ Form submit failed:', saveResult);
        }
        
    } catch (error) {
        console.error('❌ Error in form submission:', error);
        showNotification('error', '❌ Error Sistem', 'Terjadi error saat menyimpan data:\n\n' + error.message, false);
    } finally {
        // Sembunyikan loading dan enable form
        hideLoading();
        enableForm();
    }
}
async function handleNewPosition() {
    const kodeSaham = document.getElementById('kodeSaham').value.toUpperCase();
    const tanggalMasuk = document.getElementById('tanggalMasuk').value;
    const lot = parseInt(document.getElementById('lot').value);
    const hargaMasuk = parseFloat(document.getElementById('hargaMasuk').value);
    const feeBuy = parseFloat(document.getElementById('feeBuy').value) || 0;
    
    const positionId = generatePositionId(kodeSaham);
    
    // Hitung fee otomatis jika kosong
    let finalFeeBuy = feeBuy;
    if (!feeBuy || feeBuy === 0) {
        const autoFee = calculateAutoFee(hargaMasuk, hargaMasuk, lot);
        finalFeeBuy = autoFee.feeBuy;
    }
    
    return {
        id: generateId(),
        tanggalMasuk: tanggalMasuk,
        tanggalKeluar: '', // Kosong untuk entry
        kodeSaham: kodeSaham,
        hargaMasuk: hargaMasuk,
        hargaKeluar: 0, // 0 untuk entry
        lot: lot,
        feeBuy: finalFeeBuy,
        feeSell: 0, // 0 untuk entry
        totalFee: finalFeeBuy,
        profitLoss: 0, // 0 untuk entry
        metodeTrading: document.getElementById('metodeTrading').value || 'Average Down',
        catatan: document.getElementById('catatan').value || `Buat posisi baru - ${kodeSaham}`,
        positionData: {
            positionId: positionId,
            transactionType: 'entry',
            entryType: 'initial',
            currentAvgPrice: hargaMasuk,
            currentTotalLot: lot,
            parentPosition: null
        }
    };
}
async function handleAddToPosition() {
    const selectedPosition = getSelectedPosition();
    const tanggalMasuk = document.getElementById('tanggalMasuk').value;
    const lot = parseInt(document.getElementById('lot').value);
    const hargaMasuk = parseFloat(document.getElementById('hargaMasuk').value);
    const feeBuy = parseFloat(document.getElementById('feeBuy').value) || 0;
    
    if (!selectedPosition) {
        throw new Error('Posisi tidak ditemukan');
    }
    
    // Hitung average price baru
    const newTotalLot = selectedPosition.totalLot + lot;
    const newTotalValue = (selectedPosition.totalLot * 100 * selectedPosition.averagePrice) + (lot * 100 * hargaMasuk);
    const newAveragePrice = Math.round(newTotalValue / (newTotalLot * 100));
    
    // Hitung fee otomatis jika kosong
    let finalFeeBuy = feeBuy;
    if (!feeBuy || feeBuy === 0) {
        const autoFee = calculateAutoFee(hargaMasuk, hargaMasuk, lot);
        finalFeeBuy = autoFee.feeBuy;
    }
    
    return {
        id: generateId(),
        tanggalMasuk: tanggalMasuk,
        tanggalKeluar: '',
        kodeSaham: selectedPosition.kodeSaham,
        hargaMasuk: hargaMasuk,
        hargaKeluar: 0,
        lot: lot,
        feeBuy: finalFeeBuy,
        feeSell: 0,
        totalFee: finalFeeBuy,
        profitLoss: 0,
        metodeTrading: document.getElementById('metodeTrading').value || 'Average Down',
        catatan: document.getElementById('catatan').value || `Average down - ${selectedPosition.kodeSaham}`,
        positionData: {
            positionId: selectedPosition.id,
            transactionType: 'entry',
            entryType: 'average_down',
            currentAvgPrice: newAveragePrice,
            currentTotalLot: newTotalLot,
            parentPosition: selectedPosition.id
        }
    };
}
async function handleClosePosition() {
    const selectedPosition = getSelectedPosition();
    const tanggalKeluar = document.getElementById('tanggalKeluar').value;
    const hargaKeluar = parseFloat(document.getElementById('hargaKeluar').value);
    const feeSell = parseFloat(document.getElementById('feeSell').value) || 0;
    
    if (!selectedPosition) {
        throw new Error('Posisi tidak ditemukan');
    }
    
    // Hitung profit/loss
    const profitLoss = calculatePositionProfitLoss(selectedPosition, hargaKeluar, selectedPosition.totalLot);
    
    // Hitung fee otomatis jika kosong
    let finalFeeSell = feeSell;
    if (!feeSell || feeSell === 0) {
        const totalSellValue = selectedPosition.totalLot * 100 * hargaKeluar;
        finalFeeSell = Math.round(totalSellValue * (0.25132 / 100));
    }
    
    return {
        id: generateId(),
        tanggalMasuk: selectedPosition.entries[0].tanggal, // Tanggal posisi dibuat
        tanggalKeluar: tanggalKeluar,
        kodeSaham: selectedPosition.kodeSaham,
        hargaMasuk: selectedPosition.averagePrice, // Average price
        hargaKeluar: hargaKeluar,
        lot: selectedPosition.totalLot,
        feeBuy: selectedPosition.totalFeeBuy, // Total fee beli dari semua entries
        feeSell: finalFeeSell,
        totalFee: selectedPosition.totalFeeBuy + finalFeeSell,
        profitLoss: profitLoss,
        metodeTrading: document.getElementById('metodeTrading').value || 'Average Down',
        catatan: document.getElementById('catatan').value || `Tutup posisi - ${selectedPosition.kodeSaham}`,
        positionData: {
            positionId: selectedPosition.id,
            transactionType: 'exit',
            exitType: 'full',
            avgPrice: selectedPosition.averagePrice,
            totalLot: selectedPosition.totalLot,
            parentPosition: selectedPosition.id
        }
    };
}
async function handlePartialExit() {
    const selectedPosition = getSelectedPosition();
    const tanggalKeluar = document.getElementById('tanggalKeluar').value;
    const hargaKeluar = parseFloat(document.getElementById('hargaKeluar').value);
    const partialLot = parseInt(document.getElementById('partialLot').value);
    const feeSell = parseFloat(document.getElementById('feeSell').value) || 0;
    
    if (!selectedPosition) {
        throw new Error('Posisi tidak ditemukan');
    }
    
    // Validasi partial lot
    if (partialLot > selectedPosition.remainingLot) {
        throw new Error(`Jumlah LOT jual (${partialLot}) melebihi sisa LOT (${selectedPosition.remainingLot})`);
    }
    
    // Hitung profit/loss untuk partial exit
    const profitLoss = calculatePositionProfitLoss(selectedPosition, hargaKeluar, partialLot);
    
    // Hitung allocated fee buy
    const allocatedFeeBuy = (partialLot / selectedPosition.totalLot) * selectedPosition.totalFeeBuy;
    
    // Hitung fee otomatis jika kosong
    let finalFeeSell = feeSell;
    if (!feeSell || feeSell === 0) {
        const totalSellValue = partialLot * 100 * hargaKeluar;
        finalFeeSell = Math.round(totalSellValue * (0.25132 / 100));
    }
    
    return {
        id: generateId(),
        tanggalMasuk: selectedPosition.entries[0].tanggal,
        tanggalKeluar: tanggalKeluar,
        kodeSaham: selectedPosition.kodeSaham,
        hargaMasuk: selectedPosition.averagePrice,
        hargaKeluar: hargaKeluar,
        lot: partialLot,
        feeBuy: Math.round(allocatedFeeBuy),
        feeSell: finalFeeSell,
        totalFee: Math.round(allocatedFeeBuy) + finalFeeSell,
        profitLoss: profitLoss,
        metodeTrading: document.getElementById('metodeTrading').value || 'Average Down',
        catatan: document.getElementById('catatan').value || `Partial exit ${partialLot} lot - ${selectedPosition.kodeSaham}`,
        positionData: {
            positionId: selectedPosition.id,
            transactionType: 'exit',
            exitType: 'partial',
            avgPrice: selectedPosition.averagePrice,
            totalLot: partialLot,
            remainingLot: selectedPosition.remainingLot - partialLot,
            parentPosition: selectedPosition.id
        }
    };
}
// Test Functions
function testPhase2Features() {
    console.log('🧪 Testing Phase 2 Features...');
    
    // Test pending badge
    updatePendingBadge();
    
    // Test status indicator
    updateStatusIndicator();
    
    // Test dengan menambah pending data
    testPendingSystem();
    testPendingSystem();
    
    console.log('✅ Phase 2 features tested');
}
function testAutoSyncSystem() {
    console.log('🧪 Testing Auto-Sync System...');
    
    // Test 1: Setup system
    setupAutoSync();
    
    // Test 2: Add some pending data
    testPendingSystem();
    testPendingSystem();
    
    // Test 3: Check pending data
    const pendingData = getPendingData();
    console.log('Pending data count:', pendingData.pending_count);
    
    // Test 4: Manual sync
    processPendingSync();
    
    console.log('✅ Auto-Sync test completed');
}
function testNotificationSystem() {
    console.log('🧪 Testing notification system...');
    
    // Test different notification types
    showNotification('success', '✅ Test Success', 'Ini adalah notifikasi success!\nAuto-close dalam 3 detik.', true);
    
    setTimeout(() => {
        showNotification('error', '❌ Test Error', 'Ini adalah notifikasi error!\nUser harus klik OK.', false);
    }, 3500);
    
    setTimeout(() => {
        showNotification('warning', '⚠️ Test Warning', 'Ini adalah notifikasi warning!\nAuto-close dalam 3 detik.', true);
    }, 7000);
    
    setTimeout(() => {
        showNotification('info', 'ℹ️ Test Info', 'Ini adalah notifikasi info!\nAuto-close dalam 3 detik.', true);
    }, 10500);
}
// ================================
// SECTION 7: PORTFOLIO FUNCTIONS
// ================================
// Portfolio Initialization
function initializePortfolioData() {
    console.log('🎬 initializePortfolioData: Initializing portfolio module...');
    
    // Pastikan selalu ada default data
    if (!portfolioData.summary) {
        console.log('🆕 Setting default portfolio data...');
        portfolioData.summary = {
            totalTopUp: 0,
            totalWithdraw: 0,
            totalPL: 0,
            totalEquity: 0,
            availableCash: 0,
            growthPercent: 0,
            lastUpdated: new Date().toISOString()
        };
    }
     setupPortfolioModals();
    setupTableActions();
    console.log('✅ Portfolio initialized. Current data:', portfolioData);
    return portfolioData;
}
function setupPortfolioModals() {
    console.log('🔄 setupPortfolioModals: Initializing...');
    // Setup forms terlebih dahulu
    setupTopUpForm();
    
    // Setup withdraw form dan dapatkan update function
    //let updateWithdrawInfo = () => {};
    try {
        updateWithdrawInfo = setupWithdrawForm() || (() => {});
    } catch (error) {
        console.warn('⚠️ setupWithdrawForm error:', error);
    }
    // 1. Top Up Modal
    const topUpBtn = document.getElementById('addTopUpBtn');
    const topUpModal = document.getElementById('topUpModal');
    
    if (topUpBtn && topUpModal) {
        topUpBtn.addEventListener('click', () => {
            console.log('💰 Top Up button clicked');
            
            // Reset form
            const form = document.getElementById('topUpForm');
            if (form) form.reset();
            
            // Reset quick buttons
            document.querySelectorAll('.quick-amount').forEach(btn => {
                btn.classList.remove('active');
            });
        topUpModal.style.display = 'block';
        });
        // Close with X button
        const topUpClose = topUpModal.querySelector('.close');
        if (topUpClose) {
            topUpClose.addEventListener('click', () => {
                console.log('❌ Closing Top Up modal');
                topUpModal.style.display = 'none';
                resetPortfolioForm('topUpForm');
            });
        }
        
        // Close with Cancel button
        const cancelTopUp = document.getElementById('cancelTopUp');
        if (cancelTopUp) {
            cancelTopUp.addEventListener('click', () => {
                console.log('❌ Canceling Top Up');
                topUpModal.style.display = 'none';
                resetPortfolioForm('topUpForm');
            });
        }
        
        // Close when clicking outside
        window.addEventListener('click', (event) => {
            if (event.target === topUpModal) {
                console.log('👆 Clicked outside Top Up modal');
                topUpModal.style.display = 'none';
                resetPortfolioForm('topUpForm');
            }
        });
    }
    
    // 2. Withdraw Modal
    const withdrawBtn = document.getElementById('addWithdrawBtn');
    const withdrawModal = document.getElementById('withdrawModal');
    //const updateWithdrawInfo = setupWithdrawForm(); // Setup form dan dapatkan update function
    
    if (withdrawBtn && withdrawModal) {
       withdrawBtn.addEventListener('click', () => {
            console.log('💸 Withdraw button clicked');
            
            // Reset form
            const form = document.getElementById('withdrawForm');
            if (form) form.reset();
            
            // Reset quick buttons
            document.querySelectorAll('.quick-percent').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Update cash info
            updateWithdrawInfo();
            
            withdrawModal.style.display = 'block';
        });
        
        // Close with X button
        const withdrawClose = withdrawModal.querySelector('.close');
        if (withdrawClose) {
            withdrawClose.addEventListener('click', () => {
                console.log('❌ Closing Withdraw modal');
                withdrawModal.style.display = 'none';
                resetPortfolioForm('withdrawForm');
            });
        }
        
        // Close with Cancel button
        const cancelWithdraw = document.getElementById('cancelWithdraw');
        if (cancelWithdraw) {
            cancelWithdraw.addEventListener('click', () => {
                console.log('❌ Canceling Withdraw');
                withdrawModal.style.display = 'none';
                resetPortfolioForm('withdrawForm');
            });
        }
        
        // Close when clicking outside
        window.addEventListener('click', (event) => {
            if (event.target === withdrawModal) {
                console.log('👆 Clicked outside Withdraw modal');
                withdrawModal.style.display = 'none';
                resetPortfolioForm('withdrawForm');
            }
        });
    }
    
    // 3. Setup forms
    setupTopUpForm();
    
    console.log('✅ setupPortfolioModals: Completed');
}
/**
 * Recalculate portfolio dari awal (untuk debugging/fix data)
 */
function recalculatePortfolioFromScratch() {
    console.log('🧮 Recalculating portfolio from scratch...');
    
    // 1. Hitung dari trading data
    const totalTradingPL = tradingData.reduce((sum, trade) => {
        return sum + (parseFloat(trade.profitLoss) || 0);
    }, 0);
    
    // 2. Gunakan existing cash data atau default
    const totalTopUp = portfolioData.summary?.totalTopUp || 0;
    const totalWithdraw = portfolioData.summary?.totalWithdraw || 0;
    
    // 3. Rebuild summary object
    portfolioData.summary = {
        totalTopUp: totalTopUp,
        totalWithdraw: totalWithdraw,
        totalPL: Math.round(totalTradingPL),
        totalEquity: Math.round(totalTopUp - totalWithdraw + totalTradingPL),
        availableCash: Math.round(totalTopUp - totalWithdraw + totalTradingPL),
        growthPercent: (totalTopUp - totalWithdraw) > 0 ? 
            (totalTradingPL / (totalTopUp - totalWithdraw) * 100) : 0,
        lastUpdated: new Date().toISOString()
    };
    
    console.log('✅ Portfolio recalculated:', portfolioData.summary);
    
    // 4. Update UI
    updatePortfolioUI();
    
    return portfolioData.summary;
}
// Portfolio Data Loading
function syncPortfolioWithTradingData() {
    console.log('🔄 [SYNC] Syncing portfolio with trading data...');
    
    try {
        // 1. Validasi data tersedia
        if (!tradingData || tradingData.length === 0) {
            console.log('ℹ️ No trading data to sync');
            
            // Reset ke 0 jika tidak ada data
            if (portfolioData.summary) {
                portfolioData.summary.totalPL = 0;
                portfolioData.summary.totalEquity = 
                    (portfolioData.summary.totalTopUp || 0) - 
                    (portfolioData.summary.totalWithdraw || 0);
                portfolioData.summary.availableCash = portfolioData.summary.totalEquity;
            }
            return;
        }
        
        // 2. Hitung total P/L dari tradingData (dengan validasi)
        let totalTradingPL = 0;
        let validTrades = 0;
        
        tradingData.forEach(trade => {
            const pl = parseFloat(trade.profitLoss);
            if (!isNaN(pl)) {
                totalTradingPL += pl;
                validTrades++;
            } else {
                console.warn('⚠️ Invalid profitLoss in trade:', trade);
            }
        });
        
        console.log(`📈 Calculated P/L: ${formatCurrency(totalTradingPL)} from ${validTrades}/${tradingData.length} valid trades`);
        
        // 3. Update portfolioData.summary jika ada
        if (portfolioData.summary) {
            const oldPL = portfolioData.summary.totalPL || 0;
            const oldEquity = portfolioData.summary.totalEquity || 0;
            
            // Update values
            portfolioData.summary.totalPL = Math.round(totalTradingPL);
            
            // Equity = Initial Capital + Trading P/L
            // Initial Capital = Total Top Up - Total Withdraw
            const initialCapital = 
                (portfolioData.summary.totalTopUp || 0) - 
                (portfolioData.summary.totalWithdraw || 0);
            
            portfolioData.summary.totalEquity = Math.round(initialCapital + totalTradingPL);
            portfolioData.summary.availableCash = portfolioData.summary.totalEquity;
            
            // Update timestamp
            portfolioData.summary.lastUpdated = new Date().toISOString();
            
            // Calculate growth percentage (if initial capital > 0)
            if (initialCapital > 0) {
                portfolioData.summary.growthPercent = 
                    ((totalTradingPL / initialCapital) * 100);
            }
            
            console.log('✅ Portfolio updated:', {
                'Previous PL': formatCurrency(oldPL),
                'New PL': formatCurrency(totalTradingPL),
                'Change': formatCurrency(totalTradingPL - oldPL),
                'Equity': formatCurrency(portfolioData.summary.totalEquity)
            });
            
            // 4. Update UI jika portfolio section aktif
            if (document.getElementById('portfolio')?.classList.contains('active')) {
                console.log('🎨 Updating portfolio UI...');
                updatePortfolioUI();
            }
            
            // 5. Update dashboard metrics juga
            updateDashboardWithPortfolioInfo();
            
        } else {
            console.warn('⚠️ Portfolio summary not initialized, initializing...');
            initializePortfolioData();
            syncPortfolioWithTradingData(); // Retry
        }
        
    } catch (error) {
        console.error('❌ Error syncing portfolio with trading data:', error);
    }
}
async function fetchPortfolioSummary() {
    console.log('📊 fetchPortfolioSummary: Fetching summary data...');
    
    try {
        // ⭐⭐ Tambah cache buster ⭐⭐
        const url = `${APPS_SCRIPT_URL}?action=portfolio/summary&t=${Date.now()}`;
        console.log('📊 Fetching from:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📊 fetchPortfolioSummary: Response received:', data);
        
        return data;
    } catch (error) {
        console.error('❌ fetchPortfolioSummary: Error fetching:', error);
        return { 
            success: false, 
            error: error.toString(),
            message: 'Gagal mengambil data summary portfolio'
        };
    }
}
async function fetchPortfolioTransactions() {
    console.log('📋 fetchPortfolioTransactions: Fetching transaction data...');
    
    try {
        // ⭐⭐ Tambah cache buster ⭐⭐
        const url = `${APPS_SCRIPT_URL}?action=portfolio/transactions&t=${Date.now()}`;
        console.log('📋 Fetching from:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📋 fetchPortfolioTransactions: Response received, count:', data.transactions?.length || 0);
        
        return data;
    } catch (error) {
        console.error('❌ fetchPortfolioTransactions: Error fetching:', error);
        return { 
            success: false, 
            error: error.toString(),
            message: 'Gagal mengambil data transaksi'
        };
    }
}
async function loadPortfolioData() {
    console.log('🚀 loadPortfolioData: Starting to load portfolio data...');
    
    // Show loading state
    const portfolioSection = document.getElementById('portfolio');
    if (portfolioSection && portfolioSection.classList.contains('active')) {
        console.log('📱 Portfolio section is active, showing loading...');
        
        // Add loading class to table
        const tableBody = document.getElementById('transactionTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr class="loading-row">
                    <td colspan="7" style="text-align: center;">
                        <div class="loading-spinner-small"></div>
                        Loading portfolio data...
                    </td>
                </tr>
            `;
        }
    }
    
    try {
        console.log('🔄 Loading summary and transactions in parallel...');
        
        // Load both in parallel
        const [summaryResult, transactionsResult] = await Promise.all([
            fetchPortfolioSummary(),
            fetchPortfolioTransactions()
        ]);
        
        console.log('✅ Parallel loading completed');
        console.log('Summary success:', summaryResult.success);
        console.log('Transactions success:', transactionsResult.success);
        
        // Process summary
        if (summaryResult.success) {
            portfolioData.summary = summaryResult.summary;
            console.log('📈 Summary data loaded:', portfolioData.summary);
            
            // Update UI if portfolio section is active
            if (document.getElementById('portfolio')?.classList.contains('active')) {
                updatePortfolioUI();
            }
        } else {
            console.error('❌ Failed to load summary:', summaryResult.error);
            showNotification('error', 'Gagal memuat summary portfolio: ' + (summaryResult.error || 'Unknown error'));
        }
        
        // Process transactions
        if (transactionsResult.success) {
            portfolioData.transactions = transactionsResult.transactions || [];
            console.log('📋 Transactions loaded:', portfolioData.transactions.length, 'records');
            
            // Update UI if portfolio section is active
            if (document.getElementById('portfolio')?.classList.contains('active')) {
                updateTransactionTable();
            }
        } else {
            console.error('❌ Failed to load transactions:', transactionsResult.error);
            showNotification('error', 'Gagal memuat riwayat transaksi');
        }
        
        // Update withdraw form data
        updateWithdrawFormData();
        
        console.log('🎉 loadPortfolioData: Completed successfully');
        return {
            success: true,
            summaryLoaded: summaryResult.success,
            transactionsLoaded: transactionsResult.success,
            summary: portfolioData.summary,
            transactionCount: portfolioData.transactions.length
        };
        
    } catch (error) {
        console.error('💥 loadPortfolioData: Error loading portfolio data:', error);
        showNotification('error', 'Gagal memuat data portfolio: ' + error.message);
        return { 
            success: false, 
            error: error.toString(),
            message: 'Gagal memuat data portfolio'
        };
    }
}
async function updatePortfolioSummaryInSheets() {
    console.log('📤 updatePortfolioSummaryInSheets: Saving to Google Sheets...');
    
    if (!portfolioData.summary) {
        console.warn('⚠️ No portfolio summary to save');
        return { success: false, error: 'No summary data' };
    }
    
    try {
        // Format data untuk Google Sheets
        const summary = portfolioData.summary;
        
        // Pastikan ada lastUpdated
        summary.lastUpdated = new Date().toISOString();
        
        console.log('📊 Saving portfolio summary:', {
            totalPL: summary.totalPL,
            totalEquity: summary.totalEquity,
            lastUpdated: summary.lastUpdated
        });
        
        // Kirim ke Google Sheets
        const params = new URLSearchParams({
            action: 'portfolio/update',
            totalTopUp: summary.totalTopUp || 0,
            totalWithdraw: summary.totalWithdraw || 0,
            totalPL: summary.totalPL || 0,
            totalEquity: summary.totalEquity || 0,
            availableCash: summary.availableCash || 0,
            growthPercent: summary.growthPercent || 0,
            lastUpdated: summary.lastUpdated
        });
        
        const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
        console.log('📤 Sending to:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('📥 Server response:', result);
        
        if (result.success) {
            console.log('✅ Portfolio summary saved to Google Sheets');
            return { success: true };
        } else {
            throw new Error(result.error || 'Failed to save portfolio summary');
        }
        
    } catch (error) {
        console.error('❌ Error saving portfolio summary to Sheets:', error);
        
        // Simpan ke pending queue jika online/offline system sudah ada
        const pendingData = getPendingData();
        if (pendingData) {
            console.log('📴 Saving to pending queue for retry...');
            // Anda bisa extend pending system untuk portfolio
        }
        
        return { 
            success: false, 
            error: error.message,
            message: 'Gagal menyimpan portfolio ke Google Sheets'
        };
    }
}
// Portfolio UI
function updatePortfolioUI() {
    console.log('🎨 updatePortfolioUI: Updating portfolio UI...');
    
    if (!portfolioData.summary) {
        console.warn('⚠️ updatePortfolioUI: No summary data available');
        return;
    }
    
    const summary = portfolioData.summary;
    console.log('📊 updatePortfolioUI: Using summary:', summary);
    
    try {
        // Helper formatting functions
        const formatRp = (num) => {
            if (num === undefined || num === null) return 'Rp 0';
            return 'Rp ' + new Intl.NumberFormat('id-ID').format(num);
        };
        
        const formatPercent = (num) => {
            if (num === undefined || num === null) return '0%';
            return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
        };
        
        // Update summary cards
        const elementsToUpdate = [
            { id: 'totalTopUp', value: formatRp(summary.totalTopUp) },
            { id: 'totalWithdraw', value: formatRp(summary.totalWithdraw) },
            { id: 'totalEquity', value: formatRp(summary.totalEquity) },
            { id: 'totalCash', value: formatRp(summary.availableCash) },
            { id: 'growthValue', value: formatPercent(summary.growthPercent) }
        ];
        
        elementsToUpdate.forEach(item => {
            const element = document.getElementById(item.id);
            if (element) {
                element.textContent = item.value;
                console.log(`✅ Updated ${item.id}: ${item.value}`);
            } else {
                console.warn(`⚠️ Element not found: ${item.id}`);
            }
        });
        
        // Update breakdown section
        const breakdownElements = [
            { id: 'initialCapital', value: formatRp(summary.totalTopUp) },
            { id: 'totalTradingPL', value: `${summary.totalPL >= 0 ? '+' : ''}${formatRp(summary.totalPL)}` },
            { id: 'netCashFlow', value: formatRp(summary.totalTopUp - summary.totalWithdraw) },
            { id: 'calculatedEquity', value: formatRp(summary.totalEquity) }
        ];
        
        breakdownElements.forEach(item => {
            const element = document.getElementById(item.id);
            if (element) {
                element.textContent = item.value;
                console.log(`✅ Updated breakdown ${item.id}: ${item.value}`);
            }
        });
        
        // Update growth trend indicators
        updateTrendIndicators();
        
        // Update timestamp if exists
        const lastUpdatedEl = document.getElementById('lastUpdated');
        if (lastUpdatedEl && summary.lastUpdated) {
            try {
                const date = new Date(summary.lastUpdated);
                const formattedDate = date.toLocaleDateString('id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                lastUpdatedEl.textContent = `Update: ${formattedDate}`;
                console.log(`✅ Updated lastUpdated: ${formattedDate}`);
            } catch (dateError) {
                console.warn('⚠️ Could not format date:', dateError);
            }
        }
        
        console.log('✅ updatePortfolioUI: UI updated successfully');
        
    } catch (error) {
        console.error('❌ updatePortfolioUI: Error updating UI:', error);
    }
}
function updateTransactionTable() {
    console.log('📋 updateTransactionTable: Updating transaction table...');
    
    const tbody = document.getElementById('transactionTableBody');
    if (!tbody) {
        console.error('❌ updateTransactionTable: Table body not found');
        return;
    }
    
    if (!portfolioData.transactions || portfolioData.transactions.length === 0) {
        console.log('📭 No transactions to display');
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <div style="font-size: 48px; margin-bottom: 10px;">📭</div>
                    <div>Belum ada transaksi dana</div>
                    <div style="font-size: 12px; margin-top: 10px;">Mulai dengan Top Up pertama Anda</div>
                </td>
            </tr>
        `;
        return;
    }
    
    console.log(`📋 Displaying ${portfolioData.transactions.length} transactions`);
    
    // Sort by timestamp (newest first)
    const sortedTransactions = [...portfolioData.transactions].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    // Clear table
    tbody.innerHTML = '';
    
    // Add rows
    sortedTransactions.forEach((transaction, index) => {
        const row = document.createElement('tr');
        const isTopUp = transaction.type === 'TOP_UP';
        
        // Format date
        let formattedDate = '-';
        let formattedTime = '';
        try {
            const date = new Date(transaction.timestamp);
            formattedDate = date.toLocaleDateString('id-ID', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            formattedTime = date.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            console.warn(`⚠️ Could not format date for transaction ${index}:`, e);
        }
        
        // Format amount
        const amountClass = isTopUp ? 'positive' : 'negative';
        const amountSign = isTopUp ? '+' : '-';
        const formattedAmount = `${amountSign}Rp ${formatNumber(Math.abs(transaction.amount))}`;
        
        // Format balance
        const formattedBalance = `Rp ${formatNumber(transaction.balanceAfter || 0)}`;
        
        row.innerHTML = `
                   <td>
                <div>${formattedDate}</div>
                <small style="color: #7f8c8d;">${formattedTime}</small>
            </td>
            <td>
                <span class="transaction-badge ${isTopUp ? 'topup-badge' : 'withdraw-badge'}">
                    ${isTopUp ? 'TOP UP' : 'WITHDRAW'}
                </span>
            </td>
            <td class="${amountClass}" style="font-weight: 600;">${formattedAmount}</td>
            <td>${transaction.method || '-'}</td>
            <td title="${transaction.notes || ''}">${transaction.notes ? truncateText(transaction.notes, 30) : '-'}</td>
            <td style="font-weight: 500;">${formattedBalance}</td>
            <td>
                <button class="action-btn edit-btn" onclick="editTransaction('${transaction.id}')" title="Edit">✏️</button>
                <button class="action-btn delete-btn" onclick="deleteTransaction('${transaction.id}')" title="Hapus">🗑️</button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    console.log('✅ updateTransactionTable: Table updated successfully');
}
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}
function updateTrendIndicators() {
    console.log('📈 updateTrendIndicators: Updating trend indicators...');
    
    if (!portfolioData.summary) {
        console.warn('⚠️ No summary data for trend indicators');
        return;
    }
    
    const growth = portfolioData.summary.growthPercent || 0;
    
    // Update growth trend element if exists
    const growthElement = document.getElementById('growthChange');
    if (growthElement) {
        if (growth >= 0) {
            growthElement.innerHTML = `<span class="trend-up">↗ +${growth.toFixed(2)}%</span> all time`;
            console.log(`✅ Growth trend: Positive (+${growth.toFixed(2)}%)`);
        } else {
            growthElement.innerHTML = `<span class="trend-down">↘ ${growth.toFixed(2)}%</span> all time`;
            console.log(`⚠️ Growth trend: Negative (${growth.toFixed(2)}%)`);
        }
    }
    
    // Update other trend indicators if they exist
    const trendElements = {
        plTrend: portfolioData.summary.totalPL || 0,
        winRateTrend: 0, // You can calculate this from trading data
        tradesTrend: 0   // You can calculate this from trading data
    };
    
    Object.keys(trendElements).forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            const value = trendElements[elementId];
            if (value > 0) {
                element.innerHTML = `<span class="trend-up">↗ +${formatNumber(value)}</span>`;
            } else if (value < 0) {
                element.innerHTML = `<span class="trend-down">↘ ${formatNumber(value)}</span>`;
            } else {
                element.innerHTML = `<span class="trend-neutral">→ 0</span>`;
            }
        }
    });
}
function updateWithdrawFormData() {
    console.log('💰 updateWithdrawFormData: Updating withdraw form...');
    
    if (!portfolioData.summary) {
        console.warn('⚠️ No summary data for withdraw form');
        return;
    }
    
    const availableCash = portfolioData.summary.availableCash || 0;
    console.log(`💰 Available cash: Rp ${formatNumber(availableCash)}`);
    
    // Update modal info
    const availableCashEl = document.getElementById('availableCash');
    const maxWithdrawEl = document.getElementById('maxWithdraw');
    
    if (availableCashEl) {
        availableCashEl.textContent = `Rp ${formatNumber(availableCash)}`;
        console.log('✅ Updated availableCash display');
    }
    
    if (maxWithdrawEl) {
        maxWithdrawEl.textContent = `Rp ${formatNumber(availableCash)}`;
        console.log('✅ Updated maxWithdraw display');
    }
}

// Portfolio Transactions
async function addPortfolioTransaction(transactionData) {
    console.log('➕ addPortfolioTransaction:', transactionData);
    
    try {
        // Validate
        const availableCash = portfolioData.summary?.availableCash || 0;
        const validation = validateTransactionAmount(
            transactionData.amount, 
            transactionData.type,
            transactionData.type === 'WITHDRAW' ? availableCash : 0
        );
        
        if (!validation.valid) {
            throw new Error(validation.error);
        }
        
        // ⭐⭐ PERBAIKAN: Gunakan format SAMA PERSIS dengan URL yang berhasil ⭐⭐
        // Format: ?action=portfolio/add&type=TOP_UP&amount=1000
        const params = new URLSearchParams();
        params.append('action', 'portfolio/add');
        params.append('type', transactionData.type); // langsung string, tidak perlu uppercase
        params.append('amount', Math.abs(Number(transactionData.amount)).toString());
        params.append('method', transactionData.method || 'BANK_TRANSFER');
        
        // Notes optional - hanya tambah jika ada
        if (transactionData.notes && transactionData.notes.trim()) {
            params.append('notes', transactionData.notes.trim());
        }
        
        const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
        console.log('📤 Sending GET request to:', url);
        
        // Show loading
        showPortfolioLoading(transactionData.type === 'TOP_UP' ? 'Memproses Top Up...' : 'Memproses Withdraw...');
        
        // Fetch dengan timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('📥 Server response:', result);
        
        // Hide loading
        hidePortfolioLoading();
        
        if (result.success) {
            console.log('✅ Transaction added successfully:', result);
            
            // Show success message
            const actionText = transactionData.type === 'TOP_UP' ? 'Top Up' : 'Withdraw';
            const message = `${actionText} Rp ${formatNumber(transactionData.amount)} berhasil!`;
            showPortfolioNotification('success', message);
            
            // Refresh portfolio data setelah delay
            setTimeout(async () => {
                console.log('🔄 Refreshing portfolio data...');
                await loadPortfolioData();
            }, 1500);
            
            return result;
        } else {
            throw new Error(result.error || 'Gagal menambah transaksi');
        }
        
    } catch (error) {
        console.error('❌ Error in addPortfolioTransaction:', error);
        hidePortfolioLoading();
        
        // User friendly error messages
        let errorMessage = error.message;
        if (error.name === 'AbortError') {
            errorMessage = 'Timeout: Server tidak merespon. Coba lagi nanti.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Tidak dapat terhubung ke server. Cek koneksi internet.';
        }
        
        showPortfolioNotification('error', errorMessage);
        return { success: false, error: errorMessage };
    }
}
async function editTransaction(transactionId) {
    console.log('✏️ editTransaction: Editing transaction ID:', transactionId);
    
    if (!transactionId) {
        console.error('❌ Transaction ID is required');
        showPortfolioNotification('error', 'Transaction ID tidak valid');
        return;
    }
    
    const transaction = portfolioData.transactions.find(t => t.id === transactionId);
    
    if (!transaction) {
        console.error('❌ Transaction not found:', transactionId);
        showPortfolioNotification('error', 'Transaksi tidak ditemukan');
        return;
    }
    
    console.log('📋 Found transaction:', transaction);
    
    // Untuk edit, kita perlu endpoint baru di GS
    // Untuk sekarang, tampilkan info dengan MODAL
    const modalTitle = 'Edit Transaction (Coming Soon)';
    const modalMessage = 
        `ID: ${transaction.id}\n` +
        `Type: ${transaction.type}\n` +
        `Amount: Rp ${formatNumber(Math.abs(transaction.amount))}\n` +
        `Method: ${transaction.method}\n` +
        `Notes: ${transaction.notes || '(empty)'}\n\n` +
        `Edit functionality will be available in next update.`;
    
    // Gunakan modal informasi, bukan alert()
    await showInfoModal(modalTitle, modalMessage);
    
    console.log('⚠️ Edit functionality not yet implemented');
    showPortfolioNotification('info', 'Fitur edit akan segera tersedia');
}
async function deleteTransaction(transactionId) {
    console.log('🗑️ deleteTransaction: Deleting transaction ID:', transactionId);
    
    if (!transactionId) {
        console.error('❌ Transaction ID is required');
        showPortfolioNotification('error', 'Transaction ID tidak valid');
        return;
    }
    
    const transaction = portfolioData.transactions.find(t => t.id === transactionId);
    
    if (!transaction) {
        console.error('❌ Transaction not found:', transactionId);
        showPortfolioNotification('error', 'Transaksi tidak ditemukan');
        return;
    }
    
    // Konfirmasi delete dengan MODAL (bukan alert)
    const isTopUp = transaction.type === 'TOP_UP';
    const actionText = isTopUp ? 'TOP UP' : 'WITHDRAW';
    const amountText = `Rp ${formatNumber(Math.abs(transaction.amount))}`;
    const dateText = new Date(transaction.timestamp).toLocaleDateString('id-ID');
    
    const modalTitle = 'HAPUS TRANSAKSI?';
    const modalMessage = 
        `Tanggal: ${dateText}\n` +
        `Jenis: ${actionText}\n` +
        `Jumlah: ${amountText}\n` +
        `Metode: ${transaction.method || '-'}\n` +
        `Catatan: ${transaction.notes || '-'}\n\n` +
        `Transaksi akan dihapus permanen!`;
    
    // Gunakan modal confirmation, bukan alert()
    const confirmation = await showConfirmationModal(modalTitle, modalMessage);
    
    if (!confirmation) {
        console.log('❌ Delete cancelled by user');
        return;
    }
    
    // ⭐ LOGIC DELETE YANG SAMA (tidak diubah) ⭐
    try {
        console.log('🗑️ Deleting transaction...');
        showPortfolioLoading('Menghapus transaksi...');
        
        const params = new URLSearchParams({
            action: 'portfolio/delete',
            id: transactionId
        });
        
        const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
        console.log('📤 Sending DELETE request:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        hidePortfolioLoading();
        
        if (result.success) {
            console.log('✅ Transaction deleted:', result);
            showPortfolioNotification('success', 'Transaksi berhasil dihapus');
            
            // Refresh data setelah delay
            setTimeout(async () => {
                await loadPortfolioData();
            }, 1000);
            
        } else {
            throw new Error(result.error || 'Gagal menghapus transaksi');
        }
        
    } catch (error) {
        console.error('❌ Error deleting transaction:', error);
        hidePortfolioLoading();
        showPortfolioNotification('error', error.message);
    }
}
function setupTopUpForm() {
    console.log('🔄 setupTopUpForm: Initializing...');
    
    const form = document.getElementById('topUpForm');
    if (!form) {
        console.warn('⚠️ Top Up form not found');
        return;
    }
    
    // Remove existing listeners
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    // Quick amount buttons - FIXED
    document.querySelectorAll('.quick-amount').forEach(btn => {
        btn.addEventListener('click', function() {
            const amount = this.getAttribute('data-amount');
            document.getElementById('topUpAmount').value = amount;
            
            // Highlight active button
            document.querySelectorAll('.quick-amount').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // ⭐⭐ FIX: Pakai formatNumber yang sudah didefinisikan ⭐⭐
            console.log(`💰 Quick amount selected: Rp ${formatNumber(amount)}`);
        });
    });
    
    // Form submission - FIXED validation
    newForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('📝 Top Up form submitted');
        
        // Get form values
        const amountInput = document.getElementById('topUpAmount');
        const methodSelect = document.getElementById('topUpMethod');
        const notesInput = document.getElementById('topUpNotes');
        
        // Basic validation
        if (!amountInput.value || Number(amountInput.value) <= 0) {
            showPortfolioNotification('error', '❌ Jumlah harus diisi dan lebih dari 0');
            amountInput.focus();
            return;
        }
        
        const formData = {
            type: 'TOP_UP',
            amount: amountInput.value,
            method: methodSelect.value || 'BANK_TRANSFER',
            notes: notesInput.value || ''
        };
        
        console.log('📋 Form data:', formData);
        
        const result = await addPortfolioTransaction(formData);
        
        if (result && result.success) {
            // Close modal
            document.getElementById('topUpModal').style.display = 'none';
            // Reset form
            this.reset();
            // Reset quick buttons
            document.querySelectorAll('.quick-amount').forEach(btn => {
                btn.classList.remove('active');
            });
        }
    });
    
    console.log('✅ setupTopUpForm: Completed');
}
function resetPortfolioForm(formId) {
    console.log(`🔄 resetPortfolioForm: ${formId}`);
    
    const form = document.getElementById(formId);
    if (form) {
        form.reset();
        
        // Reset quick buttons
        if (formId === 'topUpForm') {
            document.querySelectorAll('.quick-amount').forEach(btn => {
                btn.classList.remove('active');
            });
        } else if (formId === 'withdrawForm') {
            document.querySelectorAll('.quick-percent').forEach(btn => {
                btn.classList.remove('active');
            });
        }
    }
}

//new function
/**
 * Sync portfolio summary dengan latest trading data dan save ke Google Sheets
 * Dipanggil setiap kali trading data berubah
 */
async function syncPortfolioWithTradingData() {
    console.log('🔄 [SYNC] Syncing portfolio with trading data...');
    
    try {
        // 1. Validasi data tersedia
        if (!tradingData || tradingData.length === 0) {
            console.log('ℹ️ No trading data to sync');
            
            // Reset ke 0 jika tidak ada data
            if (portfolioData.summary) {
                portfolioData.summary.totalPL = 0;
                portfolioData.summary.totalEquity = 
                    (portfolioData.summary.totalTopUp || 0) - 
                    (portfolioData.summary.totalWithdraw || 0);
                portfolioData.summary.availableCash = portfolioData.summary.totalEquity;
                portfolioData.summary.lastUpdated = new Date().toISOString();
                
                // Calculate growth percentage
                const initialCapital = portfolioData.summary.totalEquity;
                if (initialCapital > 0) {
                    portfolioData.summary.growthPercent = 0;
                }
            }
            
            // Auto-save ke Sheets meski data kosong
            await autoSavePortfolioToSheets();
            return;
        }
        
        // 2. Hitung total P/L dari tradingData (dengan validasi)
        let totalTradingPL = 0;
        let validTrades = 0;
        
        tradingData.forEach(trade => {
            const pl = parseFloat(trade.profitLoss);
            if (!isNaN(pl)) {
                totalTradingPL += pl;
                validTrades++;
            } else {
                console.warn('⚠️ Invalid profitLoss in trade:', trade);
            }
        });
        
        console.log(`📈 Calculated P/L: ${formatCurrency(totalTradingPL)} from ${validTrades}/${tradingData.length} valid trades`);
        
        // 3. Update portfolioData.summary jika ada
        if (portfolioData.summary) {
            const oldPL = portfolioData.summary.totalPL || 0;
            const oldEquity = portfolioData.summary.totalEquity || 0;
            
            // Update values
            portfolioData.summary.totalPL = Math.round(totalTradingPL);
            
            // Equity = Initial Capital + Trading P/L
            // Initial Capital = Total Top Up - Total Withdraw
            const initialCapital = 
                (portfolioData.summary.totalTopUp || 0) - 
                (portfolioData.summary.totalWithdraw || 0);
            
            portfolioData.summary.totalEquity = Math.round(initialCapital + totalTradingPL);
            portfolioData.summary.availableCash = portfolioData.summary.totalEquity;
            
            // Update timestamp
            portfolioData.summary.lastUpdated = new Date().toISOString();
            
            // Calculate growth percentage (if initial capital > 0)
            if (initialCapital > 0) {
                portfolioData.summary.growthPercent = 
                    ((totalTradingPL / initialCapital) * 100);
            } else {
                portfolioData.summary.growthPercent = 0;
            }
            
            console.log('✅ Portfolio updated:', {
                'Previous PL': formatCurrency(oldPL),
                'New PL': formatCurrency(totalTradingPL),
                'Change': formatCurrency(totalTradingPL - oldPL),
                'Equity': formatCurrency(portfolioData.summary.totalEquity),
                'Last Updated': portfolioData.summary.lastUpdated
            });
            
            // 4. Save to Google Sheets
            const saveResult = await autoSavePortfolioToSheets();
            
            if (!saveResult.success) {
                console.warn('⚠️ Portfolio updated locally but failed to save to Sheets:', saveResult.error);
                
                // Save to pending queue untuk retry nanti
                savePortfolioToPendingQueue({
                    type: 'portfolio_update',
                    summary: portfolioData.summary,
                    timestamp: new Date().toISOString(),
                    retryCount: 0
                });
            }
            
            // 5. Update UI jika portfolio section aktif
            if (document.getElementById('portfolio')?.classList.contains('active')) {
                console.log('🎨 Updating portfolio UI...');
                updatePortfolioUI();
            }
            
            // 6. Update dashboard metrics juga
            updateDashboardWithPortfolioInfo();
            
        } else {
            console.warn('⚠️ Portfolio summary not initialized, initializing...');
            initializePortfolioData();
            await syncPortfolioWithTradingData(); // Retry dengan await
        }
        
    } catch (error) {
        console.error('❌ Error syncing portfolio with trading data:', error);
        
        // Show error notification to user
        showNotification('error', '❌ Sync Gagal', 
            `Gagal menyinkronkan portfolio dengan data trading:\n\n${error.message}\n\nData tetap tersimpan secara lokal.`,
            false);
    }
}

/**
 * Auto-save portfolio summary ke Google Sheets
 */
async function autoSavePortfolioToSheets() {
    console.log('💾 autoSavePortfolioToSheets: Saving to Google Sheets...');
    
    if (!portfolioData.summary) {
        console.warn('⚠️ No portfolio summary to save');
        return { success: false, error: 'No summary data' };
    }
    
    // Check online status
    if (!navigator.onLine) {
        console.log('📴 Offline mode - portfolio saved to pending queue');
        return { 
            success: false, 
            error: 'Offline mode',
            message: 'Data disimpan ke pending queue'
        };
    }
    
    try {
        const summary = portfolioData.summary;
        
        // Prepare data for Google Sheets
        const params = new URLSearchParams({
            action: 'portfolio/update',
            totalTopUp: summary.totalTopUp || 0,
            totalWithdraw: summary.totalWithdraw || 0,
            totalPL: summary.totalPL || 0,
            totalEquity: summary.totalEquity || 0,
            availableCash: summary.availableCash || 0,
            growthPercent: summary.growthPercent || 0,
            lastUpdated: summary.lastUpdated || new Date().toISOString()
        });
        
        const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
        console.log('📤 Sending portfolio to Sheets:', url);
        
        // Add timeout to prevent hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('📥 Portfolio save response:', result);
        
        if (result.success) {
            console.log('✅ Portfolio summary saved to Google Sheets');
            
            // Clear any pending portfolio data
            clearPortfolioPendingQueue();
            
            return { success: true, data: result };
        } else {
            throw new Error(result.error || 'Failed to save portfolio summary');
        }
        
    } catch (error) {
        console.error('❌ Error saving portfolio to Sheets:', error);
        
        // Determine error type for user-friendly message
        let errorMessage = error.message;
        if (error.name === 'AbortError') {
            errorMessage = 'Timeout: Server tidak merespon. Coba lagi nanti.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Tidak dapat terhubung ke server. Cek koneksi internet.';
        }
        
        return { 
            success: false, 
            error: errorMessage,
            details: error.toString()
        };
    }
}

/**
 * Save portfolio changes to pending queue for offline/retry
 */
function savePortfolioToPendingQueue(data) {
    try {
        const pendingKey = 'portfolio_pending_changes';
        const existing = JSON.parse(localStorage.getItem(pendingKey) || '[]');
        
        const pendingItem = {
            id: `PORTFOLIO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            data: data,
            status: 'pending',
            retryCount: 0
        };
        
        existing.push(pendingItem);
        localStorage.setItem(pendingKey, JSON.stringify(existing));
        
        console.log('📝 Portfolio saved to pending queue:', pendingItem.id);
        
        // Update pending badge
        updatePortfolioPendingBadge(existing.length);
        
        return pendingItem.id;
        
    } catch (error) {
        console.error('❌ Error saving to portfolio pending queue:', error);
        return null;
    }
}

/**
 * Clear portfolio pending queue after successful sync
 */
function clearPortfolioPendingQueue() {
    localStorage.removeItem('portfolio_pending_changes');
    updatePortfolioPendingBadge(0);
    console.log('🧹 Cleared portfolio pending queue');
}

/**
 * Update portfolio pending badge
 */
function updatePortfolioPendingBadge(count) {
    const badge = document.getElementById('portfolio-pending-badge') || createPortfolioPendingBadge();
    
    if (count > 0) {
        const countElement = document.getElementById('portfolio-pending-count');
        if (countElement) {
            countElement.textContent = count;
        }
        badge.style.display = 'flex';
        badge.title = `${count} perubahan portfolio menunggu sync`;
        
        // Add urgent styling if many pending items
        if (count > 5) {
            badge.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
            badge.style.animation = 'pulse 1s infinite';
        }
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Create portfolio pending badge UI
 */
function createPortfolioPendingBadge() {
    const badge = document.createElement('div');
    badge.id = 'portfolio-pending-badge';
    badge.style.cssText = `
        position: fixed;
        top: 50px;
        right: 15px;
        background: linear-gradient(135deg, #f39c12, #e67e22);
        color: white;
        padding: 6px 10px;
        border-radius: 15px;
        font-size: 11px;
        font-weight: bold;
        z-index: 9998;
        box-shadow: 0 3px 8px rgba(243, 156, 18, 0.3);
        animation: pulse 2s infinite;
        cursor: pointer;
        display: none;
        align-items: center;
        gap: 4px;
    `;
    
    badge.innerHTML = `
        <span>💰</span>
        <span id="portfolio-pending-count">0</span>
        <span>Portfolio</span>
    `;
    
    // Click to show pending portfolio changes
    badge.addEventListener('click', showPortfolioPendingDetails);
    
    document.body.appendChild(badge);
    return badge;
}

/**
 * Show portfolio pending details
 */
function showPortfolioPendingDetails() {
    const pendingKey = 'portfolio_pending_changes';
    const pendingData = JSON.parse(localStorage.getItem(pendingKey) || '[]');
    
    if (pendingData.length === 0) {
        showNotification('info', '💰 Portfolio Sync', 'Tidak ada perubahan portfolio yang pending.', true);
        return;
    }
    
    let detailsHTML = `Anda memiliki ${pendingData.length} perubahan portfolio pending:\n\n`;
    
    pendingData.forEach((item, index) => {
        const timeAgo = getTimeAgo(item.timestamp);
        const plChange = item.data.summary?.totalPL ? 
            `P/L: ${formatCurrency(item.data.summary.totalPL)}` : 'Data portfolio';
        detailsHTML += `${index + 1}. ${plChange} (${timeAgo})\n`;
    });
    
    detailsHTML += `\nStatus: ${navigator.onLine ? '🌐 ONLINE - Akan sync otomatis' : '📴 OFFLINE - Menunggu koneksi'}`;
    
    if (navigator.onLine) {
        detailsHTML += `\n\nKlik "Sync Now" untuk sync manual.`;
        
        // Add sync button in notification
        showNotification('warning', '💰 Portfolio Pending', detailsHTML, false);
        
        const syncBtn = document.getElementById('notificationBtn');
        if (syncBtn) {
            syncBtn.textContent = '🔄 Sync Portfolio';
            syncBtn.onclick = function() {
                processPendingPortfolioSync();
                closeNotification();
            };
        }
    } else {
        showNotification('warning', '💰 Portfolio Pending', detailsHTML, false);
    }
}

/**
 * Process pending portfolio sync
 */
async function processPendingPortfolioSync() {
    const pendingKey = 'portfolio_pending_changes';
    const pendingData = JSON.parse(localStorage.getItem(pendingKey) || '[]');
    
    if (pendingData.length === 0) {
        console.log('✅ No pending portfolio changes to sync');
        return;
    }
    
    console.log(`🔄 Processing ${pendingData.length} pending portfolio changes...`);
    
    try {
        // Get the latest portfolio data
        const latestPortfolio = pendingData[pendingData.length - 1].data.summary;
        
        if (latestPortfolio) {
            // Update local portfolio data
            portfolioData.summary = { ...latestPortfolio };
            
            // Save to Sheets
            const saveResult = await autoSavePortfolioToSheets();
            
            if (saveResult.success) {
                // Clear pending queue
                clearPortfolioPendingQueue();
                
                // Update UI
                updatePortfolioUI();
                
                showNotification('success', '✅ Portfolio Synced', 
                    `${pendingData.length} perubahan portfolio berhasil di-sync ke Google Sheets!`,
                    true);
            } else {
                throw new Error('Failed to save portfolio to Sheets');
            }
        }
        
    } catch (error) {
        console.error('❌ Error processing pending portfolio sync:', error);
        showNotification('error', '❌ Sync Gagal', 
            'Gagal sync perubahan portfolio:\n\n' + error.message,
            false);
    }
}

/**
 * Smart sync portfolio dengan error handling dan offline support
 */
async function smartSyncPortfolio() {
    console.log('💾 Smart sync portfolio initiated...');
    
    try {
        // Update local data first
        const oldPL = portfolioData.summary?.totalPL || 0;
        
        // Recalculate dari trading data
        const totalTradingPL = tradingData.reduce((sum, trade) => {
            return sum + (parseFloat(trade.profitLoss) || 0);
        }, 0);
        
        // Only proceed if there's a change
        if (Math.abs(totalTradingPL - oldPL) < 100 && oldPL !== 0) {
            console.log('ℹ️ No significant change in P/L, skipping sync');
            return { success: true, skipped: true };
        }
        
        // Use the main sync function
        await syncPortfolioWithTradingData();
        
        return { success: true };
        
    } catch (error) {
        console.error('❌ Error in smart portfolio sync:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Update dashboard dengan info portfolio terbaru
 */
function updateDashboardWithPortfolioInfo() {
    try {
        // Update home dashboard jika ada elemen terkait portfolio
        const elements = [
            { id: 'totalEquity', value: portfolioData.summary?.totalEquity },
            { id: 'totalPortfolioPL', value: portfolioData.summary?.totalPL },
            { id: 'availableCash', value: portfolioData.summary?.availableCash }
        ];
        
        elements.forEach(item => {
            const element = document.getElementById(item.id);
            if (element && item.value !== undefined) {
                element.textContent = formatCurrency(item.value);
            }
        });
        
        console.log('🏠 Dashboard updated with portfolio info');
        
    } catch (error) {
        console.warn('⚠️ Error updating dashboard with portfolio info:', error);
    }
}

/**
 * Setup portfolio sync system
 */
function setupPortfolioSyncSystem() {
    console.log('🔧 Setting up portfolio sync system...');
    
    // Listen for online/offline events
    window.addEventListener('online', function() {
        console.log('🌐 Online - checking for pending portfolio changes...');
        
        const pendingKey = 'portfolio_pending_changes';
        const pendingData = JSON.parse(localStorage.getItem(pendingKey) || '[]');
        
        if (pendingData.length > 0) {
            console.log(`🔄 Found ${pendingData.length} pending portfolio changes, syncing...`);
            setTimeout(() => {
                processPendingPortfolioSync();
            }, 2000);
        }
    });
    
    // Check for pending changes on app start
    setTimeout(() => {
        const pendingKey = 'portfolio_pending_changes';
        const pendingData = JSON.parse(localStorage.getItem(pendingKey) || '[]');
        
        if (pendingData.length > 0 && navigator.onLine) {
            console.log(`📋 Found ${pendingData.length} pending portfolio changes from previous session`);
            
            showNotification('info', '💰 Sync Portfolio', 
                `Ditemukan ${pendingData.length} perubahan portfolio dari session sebelumnya.\n\nMenyinkronisasi ke Google Sheets...`,
                true);
            
            setTimeout(() => {
                processPendingPortfolioSync();
            }, 3000);
        }
    }, 5000);
    
    console.log('✅ Portfolio sync system ready');
}

/**
 * Force update portfolio from trading data (manual trigger)
 */
async function forcePortfolioUpdate() {
    console.log('💥 FORCE PORTFOLIO UPDATE');
    
    showLoading('Memperbarui portfolio...');
    
    try {
        // Recalculate everything
        const totalTradingPL = tradingData.reduce((sum, trade) => {
            return sum + (parseFloat(trade.profitLoss) || 0);
        }, 0);
        
        // Update portfolio
        if (portfolioData.summary) {
            portfolioData.summary.totalPL = Math.round(totalTradingPL);
            
            const initialCapital = 
                (portfolioData.summary.totalTopUp || 0) - 
                (portfolioData.summary.totalWithdraw || 0);
            
            portfolioData.summary.totalEquity = Math.round(initialCapital + totalTradingPL);
            portfolioData.summary.availableCash = portfolioData.summary.totalEquity;
            portfolioData.summary.lastUpdated = new Date().toISOString();
            
            if (initialCapital > 0) {
                portfolioData.summary.growthPercent = ((totalTradingPL / initialCapital) * 100);
            }
        }
        
        // Save to Sheets
        const saveResult = await autoSavePortfolioToSheets();
        
        // Update UI
        updatePortfolioUI();
        updateDashboardWithPortfolioInfo();
        
        hideLoading();
        
        if (saveResult.success) {
            showNotification('success', '✅ Portfolio Diperbarui', 
                `Portfolio berhasil diperbarui dan disimpan ke Google Sheets!\n\nTotal P/L: ${formatCurrency(totalTradingPL)}`,
                true);
        } else {
            showNotification('warning', '⚠️ Data Disimpan Lokal', 
                'Portfolio diperbarui secara lokal tetapi gagal disimpan ke Google Sheets.\n\n' +
                'Data akan dicoba simpan otomatis saat online kembali.',
                false);
        }
        
        return saveResult;
        
    } catch (error) {
        console.error('❌ Error in force portfolio update:', error);
        hideLoading();
        showNotification('error', '❌ Gagal Memperbarui', 
            'Gagal memperbarui portfolio:\n\n' + error.message,
            false);
        return { success: false, error: error.message };
    }
}

// ================================
// SECTION 8: UI & NOTIFICATION FUNCTIONS
// ================================
// Loading Modal System
function showLoadingModal() {
    const modal = document.getElementById('loadingModal');
    const content = document.getElementById('loadingContent');
    
    // Reset state
    resetLoadingModal();
    
    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Start progress animation
    startLoadingProgress();
}
function hideLoadingModal() {
    const modal = document.getElementById('loadingModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    
    // Clear progress interval
    if (loadingInterval) {
        clearInterval(loadingInterval);
    }
}
function resetLoadingModal() {
    const spinner = document.getElementById('loadingSpinner');
    const successIcon = document.getElementById('loadingSuccess');
    const errorIcon = document.getElementById('loadingError');
    const errorSection = document.getElementById('errorSection');
    const successSection = document.getElementById('successSection');
    const content = document.getElementById('loadingContent');
    
    // Reset icons
    spinner.style.display = 'block';
    successIcon.style.display = 'none';
    errorIcon.style.display = 'none';
    
    // Reset sections
    errorSection.style.display = 'none';
    successSection.style.display = 'none';
    
    // Reset progress
    updateLoadingProgress(0);
    loadingProgress = 0;
    
    // Reset classes
    content.className = 'loading-content';
}
function updateLoadingProgress(percent, status = '') {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const loadingStatus = document.getElementById('loadingStatus');
    
    progressFill.style.width = percent + '%';
    progressText.textContent = percent + '%';
    
    if (status) {
        loadingStatus.textContent = status;
    }
}
function startLoadingProgress() {
    loadingProgress = 0;
    
    loadingInterval = setInterval(() => {
        if (loadingProgress < 90) { // Stop at 90%, wait for actual completion
            loadingProgress += Math.random() * 10;
            if (loadingProgress > 90) loadingProgress = 90;
            updateLoadingProgress(Math.floor(loadingProgress));
        }
    }, 300);
}
function updateLoadingDetails(records = 0, pending = 0) {
    const dataLoaded = document.getElementById('dataLoaded');
    const pendingData = document.getElementById('pendingData');
    
    dataLoaded.textContent = records + ' records';
    pendingData.textContent = pending + ' records';
}
function showLoadingSuccess(message = 'Data berhasil dimuat!') {
    const spinner = document.getElementById('loadingSpinner');
    const successIcon = document.getElementById('loadingSuccess');
    const successSection = document.getElementById('successSection');
    const content = document.getElementById('loadingContent');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingMessage = document.getElementById('loadingMessage');
    
    // Update content
    loadingTitle.textContent = 'Siap Trading!';
    loadingMessage.textContent = message;
    
    // Switch to success state
    spinner.style.display = 'none';
    successIcon.style.display = 'block';
    successSection.style.display = 'block';
    content.classList.add('success-state');
    
    // Complete progress
    updateLoadingProgress(100, 'Selesai');
    
    // Setup success button
    const successBtn = document.getElementById('successBtn');
    successBtn.onclick = hideLoadingModal;
    
    // Auto hide after 3 seconds
    setTimeout(() => {
        if (document.getElementById('loadingModal').style.display === 'flex') {
            hideLoadingModal();
        }
    }, 3000);
}
function showLoadingError(errorMessage, retryCallback = null) {
    const spinner = document.getElementById('loadingSpinner');
    const errorIcon = document.getElementById('loadingError');
    const errorSection = document.getElementById('errorSection');
    const errorMessageEl = document.getElementById('errorMessage');
    const content = document.getElementById('loadingContent');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingMessage = document.getElementById('loadingMessage');
    
    // Update content
    loadingTitle.textContent = 'Gagal Memuat Data';
    loadingMessage.textContent = 'Terjadi masalah saat memuat data trading.';
    errorMessageEl.textContent = errorMessage;
    
    // Switch to error state
    spinner.style.display = 'none';
    errorIcon.style.display = 'block';
    errorSection.style.display = 'block';
    content.classList.add('error-state');
    
    // Stop progress
    if (loadingInterval) {
        clearInterval(loadingInterval);
    }
    updateLoadingProgress(0, 'Gagal');
    
    // Setup retry button
    const retryBtn = document.getElementById('retryBtn');
    const continueBtn = document.getElementById('continueBtn');
    
    retryBtn.onclick = function() {
        if (retryCallback) {
            resetLoadingModal();
            startLoadingProgress();
            retryCallback();
        } else {
            window.location.reload();
        }
    };
    
    continueBtn.onclick = function() {
        hideLoadingModal();
        showNotification('warning', '⚠️ Data Tidak Lengkap', 
            'Aplikasi berjalan dengan data terbatas.\n\nBeberapa fitur mungkin tidak berfungsi optimal.', 
            true
        );
    };
}
function updateLoadingStatus(status) {
    const loadingStatus = document.getElementById('loadingStatus');
    if (loadingStatus) {
        loadingStatus.textContent = status;
    }
}
function setupLoadingModalEvents() {
    // ESC key to close loading modal (hanya jika dalam state error/success)
    document.addEventListener('keydown', function(event) {
        const loadingModal = document.getElementById('loadingModal');
        if (event.key === 'Escape' && loadingModal.style.display === 'flex') {
            const errorSection = document.getElementById('errorSection');
            const successSection = document.getElementById('successSection');
            
            if (errorSection.style.display === 'block' || successSection.style.display === 'block') {
                hideLoadingModal();
            }
        }
    });
    
    // Close modal when clicking outside (hanya jika dalam state error/success)
    const loadingModal = document.getElementById('loadingModal');
    loadingModal.addEventListener('click', function(event) {
        if (event.target === loadingModal) {
            const errorSection = document.getElementById('errorSection');
            const successSection = document.getElementById('successSection');
            
            if (errorSection.style.display === 'block' || successSection.style.display === 'block') {
                hideLoadingModal();
            }
        }
    });
}
// Notification System
function showNotification(type, title, message, autoClose = true) {
    const modal = document.getElementById('notificationModal');
    const content = document.getElementById('notificationContent');
    const icon = document.getElementById('notificationIcon');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');
    const btn = document.getElementById('notificationBtn');
    
    // Reset classes
    content.className = 'notification-content';
    
    // Set content based on type
    switch(type) {
        case 'success':
            content.classList.add('notification-success');
            icon.textContent = '✅';
            icon.style.color = '#2ecc71';
            break;
        case 'warning':
            content.classList.add('notification-warning');
            icon.textContent = '⚠️';
            icon.style.color = '#f39c12';
            break;
        case 'error':
            content.classList.add('notification-error');
            icon.textContent = '❌';
            icon.style.color = '#e74c3c';
            break;
        case 'info':
            content.classList.add('notification-info');
            icon.textContent = 'ℹ️';
            icon.style.color = '#3498db';
            break;
        default:
            content.classList.add('notification-info');
            icon.textContent = '💾';
            icon.style.color = '#3498db';
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // Show modal
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
    
    // Auto close after 3 seconds if enabled
    let autoCloseTimer;
    if (autoClose) {
        autoCloseTimer = setTimeout(() => {
            closeNotification();
        }, 3000);
    }
    
    // Close button event
    btn.onclick = function() {
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        closeNotification();
    };
    
    // Close when clicking outside
    modal.onclick = function(event) {
        if (event.target === modal) {
            if (autoCloseTimer) clearTimeout(autoCloseTimer);
            closeNotification();
        }
    };
    
    // ESC key to close
    const escHandler = function(event) {
        if (event.key === 'Escape') {
            if (autoCloseTimer) clearTimeout(autoCloseTimer);
            closeNotification();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}
function closeNotification() {
    const modal = document.getElementById('notificationModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto'; // Restore scroll
}
function showConfirmationModal(title, message) {
    return new Promise((resolve) => {
        showNotification(
            'warning',
            title,
            message + '\n\nKlik OK untuk lanjut, atau tutup untuk batal.',
            false
        );
        
        const btn = document.getElementById('notificationBtn');
        btn.textContent = 'Ya, Hapus';
        btn.style.background = '#e74c3c';
        
        const originalOnClick = btn.onclick;
        
        btn.onclick = function() {
            closeNotification();
            btn.textContent = 'OK'; // Reset button text
            btn.style.background = '#3498db'; // Reset button color
            resolve(true);
        };
        
        // Handle modal close without confirmation
        const modal = document.getElementById('notificationModal');
        const closeHandler = function(event) {
            if (event.target === modal) {
                closeNotification();
                btn.textContent = 'OK'; // Reset button text
                btn.style.background = '#3498db'; // Reset button color
                modal.removeEventListener('click', closeHandler);
                resolve(false);
            }
        };
        modal.addEventListener('click', closeHandler);
    });
}
// Portfolio Notifications
function showPortfolioLoading(message = 'Memproses...') {
    console.log('⏳ showPortfolioLoading:', message);
    
    // Simple implementation
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'portfolioLoading';
    loadingDiv.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); display: flex; flex-direction: column;
        justify-content: center; align-items: center; z-index: 9999;
        color: white; font-family: sans-serif;
    `;
    
    loadingDiv.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 10px; text-align: center;">
            <div style="width: 40px; height: 40px; border: 4px solid #f3f3f3;
                border-top: 4px solid #3498db; border-radius: 50%;
                animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
            <div style="color: #333; font-size: 16px;">${message}</div>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    
    document.body.appendChild(loadingDiv);
}
function hidePortfolioLoading() {
    console.log('✅ hidePortfolioLoading');
    const loading = document.getElementById('portfolioLoading');
    if (loading) loading.remove();
}
function showPortfolioNotification(type, message) {
    console.log(`📢 showPortfolioNotification [${type}]:`, message);
    
    // Create notification element
    const notification = document.createElement('div');
    const bgColor = type === 'success' ? '#2ecc71' : 
                    type === 'error' ? '#e74c3c' : 
                    type === 'warning' ? '#f39c12' : '#3498db';
    
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: ${bgColor}; color: white; padding: 15px 20px;
        border-radius: 5px; z-index: 10000; font-family: sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;
    
    notification.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">
            ${type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️'} 
            ${type.toUpperCase()}
        </div>
        <div>${message}</div>
        <style>
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        </style>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}
// Sync Notifications
function showOfflineNotification() {
    console.log('📴 OFFLINE NOTIFICATION: Data will be saved locally');
    showNotification(
        'warning',
        '📴 Mode Offline',
        'Anda sedang dalam mode offline.\n\nData akan disimpan secara lokal dan akan sync otomatis ketika online kembali.',
        true
    );
}
function showSyncSuccessNotification(count) {
    console.log(`✅ SYNC SUCCESS: ${count} records synced to Sheets`);
    showNotification(
        'success',
        '🔄 Sync Berhasil',
        `${count} data pending berhasil di-sync ke Google Sheets!\n\nSemua data sudah tersinkronisasi dengan cloud.`,
        true
    );
}
function showSyncErrorNotification() {
    console.log('❌ SYNC FAILED: Will retry later');
    showNotification(
        'error',
        '❌ Sync Gagal',
        'Gagal melakukan sync data ke Google Sheets.\n\nSistem akan mencoba lagi secara otomatis.\nData tetap aman tersimpan secara lokal.',
        false
    );
}
function showOfflineSuccessNotification(pendingId) {
    console.log(`📴 OFFLINE SAVE: Data saved to pending queue (ID: ${pendingId})`);
    showNotification(
        'success',
        '💾 Data Disimpan Lokal',
        `Data berhasil disimpan secara lokal (Mode Offline).\n\nAkan sync otomatis ketika online kembali.\n\n📋 ID Pending: ${pendingId}`,
        false // Tidak auto-close, user harus klik OK
    );
}
function showOnlineSuccessNotification() {
    console.log('🌐 ONLINE SAVE: Data saved directly to Google Sheets');
    showNotification(
        'success',
        '✅ Berhasil Disimpan',
        'Data trading berhasil disimpan ke Google Sheets!\n\nData Anda sudah aman tersimpan di cloud.',
        true
    );
}
function showSaveErrorNotification(errorMsg) {
    console.log('❌ SAVE ERROR:', errorMsg);
    showNotification(
        'error',
        '❌ Gagal Menyimpan',
        `Gagal menyimpan data ke Google Sheets.\n\nData telah disimpan secara lokal dan akan dicoba sync otomatis nanti.\n\n🔧 Error: ${errorMsg}`,
        false
    );
}
function showStartupPendingNotification(count) {
    console.log(`📋 Startup: ${count} data pending menunggu sync`);
    showNotification(
        'info',
        '📋 Data Pending Ditemukan',
        `Ditemukan ${count} data pending dari session sebelumnya.\n\nData akan otomatis sync ketika Anda menyimpan data baru atau kembali online.`,
        true
    );
}
// General UI
function showLoading(message = 'Menyimpan data...') {
    const loadingEl = document.createElement('div');
    loadingEl.id = 'loadingOverlay';
    loadingEl.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <p>${message}</p>
            <div class="loading-timer">Estimasi: 2-5 detik</div>
        </div>
    `;
    document.body.appendChild(loadingEl);
}
function hideLoading() {
    const loadingEl = document.getElementById('loadingOverlay');
    if (loadingEl) {
        loadingEl.remove();
    }
}
function disableForm(buttonId = 'submitBtn') {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = true;
        button.innerHTML = 'Menyimpan...';
    }
}
function enableForm(buttonId = 'submitBtn') {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = false;
        button.innerHTML = 'Simpan Data';
    }
}
function disableEditForm() {
    const button = document.getElementById('updateBtn');
    if (button) {
        button.disabled = true;
        button.innerHTML = 'Mengupdate...';
    }
}
function enableEditForm() {
    const button = document.getElementById('updateBtn');
    if (button) {
        button.disabled = false;
        button.innerHTML = 'Update Data';
    }
}
// Modal Management
function setupTableActions() {
    console.log('🔄 setupTableActions: Initializing...');
    
    // Export button
    const exportBtn = document.getElementById('exportTransactions');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportTransactionHistory);
        console.log('✅ Export button setup');
    }
    
    // Filter button (placeholder untuk sekarang)
    const filterBtn = document.getElementById('filterTransactions');
    if (filterBtn) {
        filterBtn.addEventListener('click', () => {
            console.log('🔍 Filter button clicked - Feature coming soon!');
            showPortfolioNotification('info', 'Fitur filter akan segera tersedia!');
        });
        console.log('✅ Filter button setup');
    }
    
    console.log('✅ setupTableActions: Completed');
}
// ================================
// SECTION 9: INITIALIZATION
// ================================
// Main Initialization
async function initializeApp() {
    console.log('=== INITIALIZING APP ===');
    
    // Show loading modal immediately
    showLoadingModal();
    setupLoadingModalEvents();
    updateLoadingProgress(10, 'Menyiapkan aplikasi...');

    try {
        // Setup systems
        updateLoadingProgress(20, 'Menyiapkan sistem sync...');
        setupAutoSync();
        addDebugRefreshButton(); // ⭐⭐ BARU: Tambahkan tombol debug
        setupPortfolioSyncSystem();
        updateLoadingProgress(30, 'Menyiapkan UI...');
        setupStatusIndicator();
        createPendingBadge();
        addManualSyncButton();
        
        // Check pending data
        const pendingData = getPendingData();
        updateLoadingDetails(0, pendingData.pending_count);
        
        updateLoadingProgress(40, 'Memeriksa data pending...');
        if (pendingData.pending_count > 0) {
            console.log(`📋 Found ${pendingData.pending_count} pending records`);
        }
        
        // Setup event listeners
        updateLoadingProgress(50, 'Menyiapkan event listeners...');
        setupEventListeners();
        setupPositionTradingListeners();
        
        // ===== FIX 1: INITIALIZE PHASE 1 DULU =====
        console.log('🔧 Initializing Phase 1 dashboard features...');
        loadDashboardState();
        initializeDatePickers();
        setupDashboardListeners();
        
        // Load data from Google Sheets
        updateLoadingProgress(60, 'Mengambil data dari Google Sheets...');
        console.log('Memuat data dari Google Sheets...');
        
        await loadData();
        console.log('✅ Data load completed dari Google Sheets');
        
        updateLoadingProgress(80, 'Memproses data...');
        updateLoadingDetails(tradingData.length, pendingData.pending_count);
        
        // ===== FIX 2: SET DEFAULT FILTERED DATA =====
        console.log('📊 Setting default filtered data...');
        dashboardState.currentFilteredData = [...tradingData];
        
        // ===== FIX 3: UPDATE PHASE 1 METRICS DULU =====
        console.log('📈 Updating Phase 1 metrics...');
        updateFilteredMetrics(tradingData);
        updateFilterStatusDisplay();
        
        // ===== FIX 4: APPLY SAVED FILTER JIKA ADA =====
        if (dashboardState.dateRange.applied && tradingData.length > 0) {
            console.log('🔄 Applying saved filter state...');
            
            // Delay sedikit untuk pastikan UI ready
            setTimeout(() => {
                try {
                    applyDateFilter();
                    console.log('✅ Saved filter applied successfully');
                } catch (error) {
                    console.error('❌ Error applying saved filter:', error);
                    // Fallback: Show all data
                    updateFilteredMetrics(tradingData);
                    updateFilterStatusDisplay();
                }
            }, 300);
        } else {
            // Show all data by default
            console.log('ℹ️ No saved filter, showing all data');
            updateFilteredMetrics(tradingData);
            updateFilterStatusDisplay();
        }
        
        // Update tampilan
        updateLoadingProgress(90, 'Menyiapkan tampilan...');
        
        // Update charts (ini akan trigger Phase 2 juga)
        if (typeof updateCharts === 'function') {
            updateCharts();
        }
        
        if (typeof displayTradingData === 'function') {
            displayTradingData();
        }
        
        if (typeof setupPerformanceTabs === 'function') {
            setupPerformanceTabs();
        }
        
        // Final UI updates
        updatePendingBadge();
        updateManualSyncButton();
        
        // ===== FIX 5: INITIALIZE PHASE 2 SETELAH PHASE 1 READY =====
        console.log('🚀 Initializing Phase 2 features...');
        if (typeof initializePhase2Features === 'function') {
            // Delay sedikit untuk pastikan Phase 1 sudah selesai
            setTimeout(() => {
                initializePhase2Features();
                console.log('✅ Phase 2 features initialized');
            }, 500);
        }
        
        updateLoadingProgress(100, 'Selesai!');
        
        // Show success
        setTimeout(() => {
            const successMsg = tradingData.length > 0 
                ? `Berhasil memuat ${tradingData.length} data trading!` 
                : 'Aplikasi siap digunakan!';
                
            showLoadingSuccess(successMsg);
        }, 500);
        
        console.log('=== APP INITIALIZATION COMPLETED ===');
        
    } catch (error) {
        console.error('❌ Error during app initialization:', error);
        
        // Show error modal
        showLoadingError(
            `Error: ${error.message}\n\nSilakan coba lagi atau lanjutkan dengan data terbatas.`,
            initializeApp // Retry callback
        );
    }
}
function setupEventListeners() {
    // Navigation
    document.getElementById('homeBtn').addEventListener('click', () => showSection('home'));
    document.getElementById('addBtn').addEventListener('click', () => showSection('add-data'));
    document.getElementById('reportBtn').addEventListener('click', () => showSection('report'));
    document.getElementById('performanceBtn').addEventListener('click', () => showSection('performance'));
    document.getElementById('portfolioBtn').addEventListener('click', () => showSection('portfolio'));
    
    // Form submission
    document.getElementById('tradingForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('editForm').addEventListener('submit', handleEditSubmit);
    
    // // Tombol hitung otomatis
    // document.getElementById('calculateBtn').addEventListener('click', calculateAutoFeeForForm);
    // document.getElementById('calculateEditBtn').addEventListener('click', calculateAutoFeeForEdit);
    
    // Filters
    document.getElementById('applyFilters').addEventListener('click', applyFilters);
    document.getElementById('resetFilters').addEventListener('click', resetFilters);
    
    // Modal
    document.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('cancelEdit').addEventListener('click', closeModal);
    
    // Close modal ketika klik di luar modal
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('editModal');
        if (event.target === modal) {
            closeModal();
        }
    });
    
    // ESC key untuk modal
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeModal();
        }
    });
    
    
}
// Chart Initialization
function updateCharts(data = null) {
    console.log('📈 updateCharts called (integrated with Phase 2)');
    
    const dataToUse = data || 
                     (dashboardState.currentFilteredData.length > 0 ? dashboardState.currentFilteredData : tradingData);
    
    // Update line chart (existing chart)
    updateLineChart(dataToUse);
    
    // Update pie chart (existing - tetap)
    updatePieChart(dataToUse);
    
    // Update Phase 2 components
    if (typeof updateAllPhase2Components === 'function') {
        updateAllPhase2Components();
    }
}
function updateLineChart(data) {
    console.log('📈 Updating enhanced line chart with', data.length, 'items');
    
    if (!data || data.length === 0) {
        console.log('⚠️ No data for line chart');
        return;
    }
    
    const lineCtx = document.getElementById('lineChart');
    if (!lineCtx) {
        console.error('❌ Line chart canvas not found');
        return;
    }
    
    // Group data per hari
    const dailyData = {};
    data.forEach(item => {
        if (!item.tanggalMasuk) return;
        
        const day = item.tanggalMasuk.split('T')[0]; // Extract YYYY-MM-DD
        if (!dailyData[day]) {
            dailyData[day] = {
                totalPL: 0,
                trades: 0,
                profitCount: 0,
                lossCount: 0
            };
        }
        
        dailyData[day].totalPL += item.profitLoss || 0;
        dailyData[day].trades += 1;
        
        if ((item.profitLoss || 0) > 0) {
            dailyData[day].profitCount += 1;
        } else if ((item.profitLoss || 0) < 0) {
            dailyData[day].lossCount += 1;
        }
    });
    
    // Sort dates
    const dates = Object.keys(dailyData).sort();
    
    // Calculate cumulative P/L
    let cumulativePL = 0;
    const cumulativeData = dates.map(date => {
        cumulativePL += dailyData[date].totalPL;
        return cumulativePL;
    });
    
    // Daily P/L data
    const dailyPL = dates.map(date => dailyData[date].totalPL);
    
    console.log('📊 Line chart data:', {
        dates: dates.length,
        range: dates.length > 0 ? `${dates[0]} to ${dates[dates.length-1]}` : 'No dates'
    });
    
    const lineCanvas = lineCtx.getContext('2d');
    
    // Destroy existing chart
    if (chartState.chartInstance) {
        chartState.chartInstance.destroy();
    }
    
    // Create new chart
    chartState.chartInstance = new Chart(lineCanvas, {
        type: 'line',
        data: {
            labels: dates.map(date => {
                const d = new Date(date);
                return d.toLocaleDateString('id-ID', { 
                    day: 'numeric', 
                    month: 'short' 
                });
            }),
            datasets: [
                {
                    label: 'Cumulative P/L',
                    data: cumulativeData,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y',
                    pointBackgroundColor: '#3498db',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'Daily P/L',
                    data: dailyPL,
                    borderColor: '#2ecc71',
                    backgroundColor: 'rgba(46, 204, 113, 0.1)',
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y1',
                    borderDash: [5, 5],
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            
                            if (context.datasetIndex === 0) {
                                label += formatCurrency(context.raw);
                            } else {
                                const dateIndex = context.dataIndex;
                                const date = dates[dateIndex];
                                const dailyInfo = dailyData[date];
                                
                                label += formatCurrency(context.raw);
                                label += ` (${dailyInfo.trades} trades, ${dailyInfo.profitCount}W/${dailyInfo.lossCount}L)`;
                            }
                            return label;
                        },
                        title: function(context) {
                            const dateIndex = context[0].dataIndex;
                            const date = new Date(dates[dateIndex]);
                            return date.toLocaleDateString('id-ID', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            });
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(0,0,0,0.1)'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        font: {
                            size: 11
                        }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Cumulative P/L'
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value).replace('Rp', 'Rp ');
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Daily P/L'
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value).replace('Rp', 'Rp ');
                        }
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
    
    console.log('✅ Line chart updated successfully');
}
function updateBarChart(data) {
    console.log('📊 Updating bar chart with', data.length, 'items');
    
    if (!data || data.length === 0) {
        console.log('⚠️ No data for bar chart');
        return;
    }
    
    const lineCtx = document.getElementById('lineChart');
    if (!lineCtx) return;
    
    // Group data per hari
    const dailyData = {};
    data.forEach(item => {
        if (!item.tanggalMasuk) return;
        
        const day = item.tanggalMasuk.split('T')[0];
        if (!dailyData[day]) {
            dailyData[day] = {
                totalPL: 0,
                trades: 0,
                profit: 0,
                loss: 0
            };
        }
        
        const pl = item.profitLoss || 0;
        dailyData[day].totalPL += pl;
        dailyData[day].trades += 1;
        
        if (pl > 0) {
            dailyData[day].profit += pl;
        } else {
            dailyData[day].loss += Math.abs(pl);
        }
    });
    
    // Sort dates
    const dates = Object.keys(dailyData).sort();
    const dailyPL = dates.map(date => dailyData[date].totalPL);
    const profits = dates.map(date => dailyData[date].profit);
    const losses = dates.map(date => -dailyData[date].loss); // Negative untuk chart
    
    const lineCanvas = lineCtx.getContext('2d');
    
    // Destroy existing chart
    if (chartState.chartInstance) {
        chartState.chartInstance.destroy();
    }
    
    // Create bar chart
    chartState.chartInstance = new Chart(lineCanvas, {
        type: 'bar',
        data: {
            labels: dates.map(date => {
                const d = new Date(date);
                return d.toLocaleDateString('id-ID', { 
                    day: 'numeric', 
                    month: 'short' 
                });
            }),
            datasets: [
                {
                    label: 'Profit',
                    data: profits,
                    backgroundColor: 'rgba(46, 204, 113, 0.7)',
                    borderColor: '#27ae60',
                    borderWidth: 1
                },
                {
                    label: 'Loss',
                    data: losses,
                    backgroundColor: 'rgba(231, 76, 60, 0.7)',
                    borderColor: '#c0392b',
                    borderWidth: 1
                },
                {
                    label: 'Net P/L',
                    data: dailyPL,
                    type: 'line',
                    borderColor: '#3498db',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatCurrency(context.raw);
                            
                            if (context.datasetIndex === 2) { // Net P/L
                                const dateIndex = context.dataIndex;
                                const date = dates[dateIndex];
                                label += ` (${dailyData[date].trades} trades)`;
                            }
                            
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    grid: {
                        color: 'rgba(0,0,0,0.1)'
                    }
                },
                y: {
                    stacked: false,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value).replace('Rp', 'Rp ');
                        }
                    },
                    title: {
                        display: true,
                        text: 'Profit/Loss'
                    }
                }
            }
        }
    });
    
    console.log('✅ Bar chart updated successfully');
}
function updatePieChart(data) {
    console.log('🥧 Updating pie chart with', data.length, 'items');
    
    const pieCtx = document.getElementById('pieChart');
    if (!pieCtx) {
        console.error('❌ Pie chart canvas not found');
        return;
    }
    
    if (!data || data.length === 0) {
        console.log('⚠️ No data for pie chart');
        
        // Destroy existing chart jika ada
        if (pieChart) {
            pieChart.destroy();
            pieChart = null;
        }
        
        // Show placeholder
        const canvas = pieCtx;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#95a5a6';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width/2, canvas.height/2);
        
        return;
    }
    
    // Hitung distribusi metode trading
    const methodCount = {};
    
    data.forEach(item => {
        const method = item.metodeTrading || 'Unknown';
        if (!methodCount[method]) {
            methodCount[method] = 0;
        }
        methodCount[method]++;
    });
    
    const methods = Object.keys(methodCount);
    const methodData = methods.map(method => methodCount[method]);
    
    console.log('📊 Pie chart data:', { methods, counts: methodData });
    
    // Warna untuk chart
    const colors = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'];
    
    const pieCanvas = pieCtx.getContext('2d');
    
    // Destroy existing chart
    if (pieChart) {
        pieChart.destroy();
    }
    
    // Create new pie chart
    pieChart = new Chart(pieCanvas, {
        type: 'pie',
        data: {
            labels: methods,
            datasets: [{
                data: methodData,
                backgroundColor: colors.slice(0, methods.length),
                borderColor: '#ffffff',
                borderWidth: 2,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            
                            return `${label}: ${value} trades (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                animateScale: true,
                animateRotate: true
            }
        }
    });
    
    console.log('✅ Pie chart updated successfully');
}
function updateDailyBreakdownChart(data) {
    console.log('🔍 Updating daily breakdown chart with', data.length, 'items');
    
    // For now, use bar chart as breakdown
    updateBarChart(data);
    
    // TODO: Implement detailed breakdown chart in Phase 3
    console.log('📝 Daily breakdown chart - using bar chart for now');
}
// UI Initialization
function showSection(sectionId) {
    console.log('Showing section:', sectionId);
    
    // Sembunyikan semua section
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Tampilkan section yang dipilih
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    // Update tombol navigasi aktif
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const btn = document.querySelector(`#${sectionId}Btn`);
    if (btn) {
        btn.classList.add('active');
    }
    
    // Jika pindah ke home, update summary dan chart
            // ⭐⭐ PERBAIKAN: Auto-refresh saat pindah ke home ⭐⭐
    // ⭐⭐ PERBAIKAN: Auto-refresh saat pindah ke home ⭐⭐
    if (sectionId === 'home') {
        console.log('🏠 Home section - HARD refreshing dashboard...');
        
        // ⭐⭐ PERBAIKAN: Panggil hardRefreshDashboard ⭐⭐
        setTimeout(() => {
            if (typeof hardRefreshDashboard === 'function') {
                hardRefreshDashboard();
            } else {
                // Fallback
                updateHomeSummary();
                updateFilterStatusDisplay();
            }
        }, 500);
    }
    // if (sectionId === 'home') {
    //     updateHomeSummary();
    // }
    // Jika pindah ke performance, load data performance
    else if (sectionId === 'performance') {
        setTimeout(() => {
            displaySahamPerformance();
            displayMetodePerformance();
            displayTradingSummary();
        }, 100);
    }
    else if (sectionId === 'portfolio') {
         console.log('📊 Portfolio section - Initializing...');
            
            // Initialize portfolio data jika belum
            initializePortfolioData();
            
            // Update UI dengan data yang ada
            updatePortfolioUI();
            
            // Load fresh data dari server
            setTimeout(async () => {
                console.log('🚀 Starting portfolio data load from server...');
                try {
                    const result = await loadPortfolioData();
                    console.log('✅ Portfolio data loaded:', result);
                } catch (error) {
                    console.error('❌ Error loading portfolio data:', error);
                    showNotification('error', 'Gagal memuat data terbaru');
                }
            }, 300);
    }
}
function setupPerformanceTabs() {
    const tabs = document.querySelectorAll('.perf-tab');
    const tabContents = document.querySelectorAll('.perf-tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            
            tab.classList.add('active');
            const targetTab = document.getElementById(`tab-${tabName}`);
            if (targetTab) {
                targetTab.classList.add('active');
            }
            
            if (tabName === 'saham') {
                displaySahamPerformance();
            } else if (tabName === 'metode') {
                displayMetodePerformance();
            } else if (tabName === 'summary') {
                displayTradingSummary();
            }
        });
    });
    
    displaySahamPerformance();
}
// Data Display
function displayTradingData(filteredData = null) {
    const dataToDisplay = filteredData || tradingData;
    const tableBody = document.getElementById('tradingTableBody');
    
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (dataToDisplay.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="13" style="text-align: center;">Tidak ada data trading</td></tr>';
        return;
    }
    
    dataToDisplay.forEach(item => {
        const row = document.createElement('tr');
        
         // ⭐ BARU: Add position indicator
        const positionInfo = item.positionData ? 
            `<span class="position-badge" title="Position: ${item.positionData.positionId}">📊</span>` : '';
        
        row.innerHTML = `
            <td>${formatDate(item.tanggalMasuk)}</td>
            <td>${formatDate(item.tanggalKeluar)}</td>
            <td>${item.kodeSaham}</td>
            <td>${formatCurrency(item.hargaMasuk)}</td>
            <td>${formatCurrency(item.hargaKeluar)}</td>
            <td>${item.lot}</td>
            <td>${formatCurrency(item.feeBuy)}</td>
            <td>${formatCurrency(item.feeSell)}</td>
            <td>${formatCurrency(item.totalFee)}</td>
            <td>${item.metodeTrading}</td>
            <td class="${item.profitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(item.profitLoss)}</td>
            <td>${item.catatan || '-'}</td>
            <td>
                <button class="action-btn edit-btn" data-id="${item.id}">Edit</button>
                <button class="action-btn delete-btn" data-id="${item.id}">Hapus</button>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Event listeners untuk tombol edit dan hapus
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            openEditModal(id);
        });
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            deleteTradingData(id);
        });
    });
}
function displaySahamPerformance() {
    const sahamData = analyzeSahamPerformance();
    const tbody = document.getElementById('sahamPerformanceBody');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    Object.keys(sahamData).sort((a, b) => sahamData[b].totalProfit - sahamData[a].totalProfit).forEach(saham => {
        const data = sahamData[saham];
        const winRate = data.totalTrades > 0 ? (data.wins / data.totalTrades * 100) : 0;
        const avgProfit = data.totalTrades > 0 ? (data.totalProfit / data.totalTrades) : 0;
        const bestTrade = Math.max(...data.profits);
        const worstTrade = Math.min(...data.profits);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${saham}</strong></td>
            <td>${data.totalTrades}</td>
            <td>${data.wins}</td>
            <td>${data.losses}</td>
            <td>${winRate.toFixed(1)}%</td>
            <td class="${data.totalProfit >= 0 ? 'positive' : 'negative'}">${formatCurrency(data.totalProfit)}</td>
            <td class="${avgProfit >= 0 ? 'positive' : 'negative'}">${formatCurrency(avgProfit)}</td>
            <td class="${bestTrade >= 0 ? 'positive' : 'negative'}">${formatCurrency(bestTrade)}</td>
            <td class="${worstTrade >= 0 ? 'positive' : 'negative'}">${formatCurrency(worstTrade)}</td>
        `;
        tbody.appendChild(row);
    });
}
function displayMetodePerformance() {
    const metodeData = analyzeMetodePerformance();
    const tbody = document.getElementById('metodePerformanceBody');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    Object.keys(metodeData).sort((a, b) => metodeData[b].totalProfit - metodeData[a].totalProfit).forEach(metode => {
        const data = metodeData[metode];
        const winRate = data.totalTrades > 0 ? (data.wins / data.totalTrades * 100) : 0;
        const avgProfit = data.totalTrades > 0 ? (data.totalProfit / data.totalTrades) : 0;
        const successRate = data.totalTrades > 0 ? ((data.wins + data.losses) / data.totalTrades * 100) : 0;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${metode}</strong></td>
            <td>${data.totalTrades}</td>
            <td>${data.wins}</td>
            <td>${data.losses}</td>
            <td>${winRate.toFixed(1)}%</td>
            <td class="${data.totalProfit >= 0 ? 'positive' : 'negative'}">${formatCurrency(data.totalProfit)}</td>
            <td class="${avgProfit >= 0 ? 'positive' : 'negative'}">${formatCurrency(avgProfit)}</td>
            <td>${successRate.toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    });
}
function displayTradingSummary() {
    const totalTrades = tradingData.length;
    const wins = tradingData.filter(t => t.profitLoss > 0).length;
    const losses = tradingData.filter(t => t.profitLoss < 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
    
    document.getElementById('totalAllTrades').textContent = totalTrades;
    document.getElementById('totalWins').textContent = wins;
    document.getElementById('totalLosses').textContent = losses;
    document.getElementById('overallWinRate').textContent = `${winRate.toFixed(1)}%`;
    
    updatePerformanceCharts();
}
function updateHomeSummary() {
    console.log('📊 updateHomeSummary called');
    
    // Jika tidak ada data, clear charts
    if (tradingData.length === 0) {
        if (lineChart) lineChart.destroy();
        if (pieChart) pieChart.destroy();
        return;
    }
    
    // Update charts dengan data terfilter atau semua data
    const dataToUse = dashboardState.currentFilteredData.length > 0 
        ? dashboardState.currentFilteredData 
        : tradingData;
    
    updateCharts(dataToUse);
}
// Form Handlers
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const isPositionMode = document.getElementById('positionModeToggle').checked;
    const positionType = document.getElementById('positionType').value;
    
    if (isPositionMode) {
        // Mode Position Trading
        await handlePositionFormSubmit(positionType);
    } else {
        // Mode Trading Biasa (existing)
        await handleRegularFormSubmit();
    }
}
async function handleEditSubmit(event) {
    event.preventDefault();
    
    console.log('✏️ Edit form submitted');
    
    const id = document.getElementById('editId').value;
    const index = tradingData.findIndex(item => item.id === id);
    
    if (index === -1) {
        console.error('❌ Data not found for edit:', id);
        showNotification('error', '❌ Data Tidak Ditemukan', 
            'Data yang ingin diedit tidak ditemukan dalam sistem.', false);
        return;
    }
    
    // Validasi data
    const tanggalKeluar = document.getElementById('editTanggalKeluar').value;
    const tanggalMasuk = document.getElementById('editTanggalMasuk').value;
    
    if (tanggalKeluar && tanggalKeluar < tanggalMasuk) {
        showNotification('error', '❌ Tanggal Tidak Valid', 
            'Tanggal keluar tidak boleh sebelum tanggal masuk!\n\nSilakan periksa kembali tanggal yang dimasukkan.', false);
        return;
    }
    
    const lot = parseInt(document.getElementById('editLot').value);
    if (lot < 1) {
        showNotification('error', '❌ Jumlah LOT Invalid', 
            'Jumlah LOT minimal 1!\n\nSilakan masukkan jumlah LOT yang valid.', false);
        return;
    }
    
    // Tampilkan loading dan disable form
    showLoading('Mengupdate data di Google Sheets...');
    disableEditForm();
    
    try {
        // Ambil nilai fee
        const feeBuy = parseFloat(document.getElementById('editFeeBuy').value) || 0;
        const feeSell = parseFloat(document.getElementById('editFeeSell').value) || 0;
        
        // Hitung profit/loss
        const calculation = calculateProfitLoss(
            parseFloat(document.getElementById('editHargaMasuk').value),
            parseFloat(document.getElementById('editHargaKeluar').value),
            lot,
            feeBuy,
            feeSell
        );
        
        // Simpan data lama untuk debug
        const oldData = {...tradingData[index]};
        
        // Update data di array
        tradingData[index] = {
            id: id,
            tanggalMasuk: tanggalMasuk,
            tanggalKeluar: tanggalKeluar || '',
            kodeSaham: document.getElementById('editKodeSaham').value.toUpperCase(),
            hargaMasuk: parseFloat(document.getElementById('editHargaMasuk').value),
            hargaKeluar: parseFloat(document.getElementById('editHargaKeluar').value) || 0,
            lot: lot,
            feeBuy: calculation.feeBuy,
            feeSell: calculation.feeSell,
            totalFee: calculation.totalFee,
            profitLoss: calculation.profitLoss,
            metodeTrading: document.getElementById('editMetodeTrading').value,
            catatan: document.getElementById('editCatatan').value || '',
            positionData: tradingData[index].positionData // Pertahankan positionData jika ada
        };
        
        console.log('📝 Data edited successfully:');
        console.log('Old:', oldData);
        console.log('New:', tradingData[index]);
        
        // Simpan perubahan ke Google Sheets
        const saveResult = await saveData();
        
        if (!saveResult) {
            throw new Error('Gagal menyimpan ke Google Sheets');
        }
        
        console.log('✅ Data saved to Google Sheets');
        smartSyncPortfolio();
        // Tampilkan notifikasi sukses
        showNotification('success', '✅ Data Diupdate!', 
            `Data trading berhasil diupdate!\n\nKode Saham: ${tradingData[index].kodeSaham}\nProfit/Loss: ${formatCurrency(tradingData[index].profitLoss)}`, 
            true);
        
        // ⭐⭐ PERBAIKAN UTAMA: Hard refresh dashboard ⭐⭐
        console.log('🔄 Triggering hard refresh...');
        
        // Tutup modal
        closeModal();
        
        // Delay sedikit lalu refresh dashboard
        setTimeout(() => {
            console.log('🔄 Executing hard refresh after edit...');
            if (typeof hardRefreshDashboard === 'function') {
                hardRefreshDashboard();
            } else {
                console.error('❌ hardRefreshDashboard function not found!');
                // Fallback ke refresh biasa
                updateHomeSummary();
                displayTradingData();
                
                // Update Phase 2 jika ada
                if (typeof updateAllPhase2Components === 'function') {
                    updateAllPhase2Components();
                }
            }
        }, 800);
        
    } catch (error) {
        console.error('❌ Error in edit submission:', error);
        showNotification('error', '❌ Gagal Mengupdate', 
            `Gagal mengupdate data:\n\n${error.message}`, 
            false);
    } finally {
        // Sembunyikan loading dan enable form
        hideLoading();
        enableEditForm();
    }
}
function calculateAutoFeeForForm() {
    const hargaMasuk = parseFloat(document.getElementById('hargaMasuk').value) || 0;
    const hargaKeluar = parseFloat(document.getElementById('hargaKeluar').value) || 0;
    const lot = parseInt(document.getElementById('lot').value) || 1;
    
    if (hargaMasuk > 0 && hargaKeluar > 0) {
        const autoFee = calculateAutoFee(hargaMasuk, hargaKeluar, lot);
        
        document.getElementById('feeBuy').value = autoFee.feeBuy;
        document.getElementById('feeSell').value = autoFee.feeSell;
        //document.getElementById('totalFee').value = autoFee.totalFee;
        
        alert(`Fee otomatis telah dihitung:\nFee Beli: ${formatCurrency(autoFee.feeBuy)}\nFee Jual: ${formatCurrency(autoFee.feeSell)}\nTotal Fee: ${formatCurrency(autoFee.totalFee)}`);
    } else {
        alert('Harap isi harga masuk dan harga keluar terlebih dahulu!');
    }
}
function calculateAutoFeeForEdit() {
    const hargaMasuk = parseFloat(document.getElementById('editHargaMasuk').value) || 0;
    const hargaKeluar = parseFloat(document.getElementById('editHargaKeluar').value) || 0;
    const lot = parseInt(document.getElementById('editLot').value) || 1;
    
    if (hargaMasuk > 0 && hargaKeluar > 0) {
        const autoFee = calculateAutoFee(hargaMasuk, hargaKeluar, lot);
        
        document.getElementById('editFeeBuy').value = autoFee.feeBuy;
        document.getElementById('editFeeSell').value = autoFee.feeSell;
        document.getElementById('editTotalFee').value = autoFee.totalFee;
        
        alert(`Fee otomatis telah dihitung:\nFee Beli: ${formatCurrency(autoFee.feeBuy)}\nFee Jual: ${formatCurrency(autoFee.feeSell)}\nTotal Fee: ${formatCurrency(autoFee.totalFee)}`);
    } else {
        alert('Harap isi harga masuk dan harga keluar terlebih dahulu!');
    }
}
// Filter Handlers
function applyFilters() {
    const metode = document.getElementById('filterMetode').value;
    const bulan = document.getElementById('filterBulan').value;
    const saham = document.getElementById('filterSaham').value.toUpperCase();
    
    let filteredData = tradingData;
    
    if (metode) {
        filteredData = filteredData.filter(item => item.metodeTrading === metode);
    }
    
    if (bulan) {
        filteredData = filteredData.filter(item => item.tanggalMasuk.startsWith(bulan));
    }
    
    if (saham) {
        filteredData = filteredData.filter(item => item.kodeSaham.includes(saham));
    }
    
    displayTradingData(filteredData);
}
function resetFilters() {
    document.getElementById('filterMetode').value = '';
    document.getElementById('filterBulan').value = '';
    document.getElementById('filterSaham').value = '';
    displayTradingData();
}
// Modal Handlers
function closeModal() {
    const modal = document.getElementById('editModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}
function openEditModal(id) {
    const data = tradingData.find(item => item.id === id);
    
    if (!data) return;
    
    // Isi form dengan data
    document.getElementById('editId').value = data.id;
    document.getElementById('editTanggalMasuk').value = data.tanggalMasuk;
    document.getElementById('editTanggalKeluar').value = data.tanggalKeluar;
    document.getElementById('editKodeSaham').value = data.kodeSaham;
    document.getElementById('editHargaMasuk').value = data.hargaMasuk;
    document.getElementById('editHargaKeluar').value = data.hargaKeluar;
    document.getElementById('editLot').value = data.lot;
    document.getElementById('editFeeBuy').value = data.feeBuy;
    document.getElementById('editFeeSell').value = data.feeSell;
    //document.getElementById('editTotalFee').value = data.totalFee;
    document.getElementById('editMetodeTrading').value = data.metodeTrading;
    document.getElementById('editCatatan').value = data.catatan || '';
    
    // Update profit preview
  
    
    // Tampilkan modal
    const modal = document.getElementById('editModal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}
// Refresh Functions
function refreshDashboard() {
    console.log('🔄 Manual dashboard refresh triggered');
    console.log('📊 Current tradingData length:', tradingData.length);
    
    // Debug: Tampilkan semua kode saham dalam tradingData
    console.log('🔍 All stocks in tradingData:', 
        tradingData.map(item => `${item.kodeSaham} (${item.id})`));
    
    // 1. Update dashboard state dengan data terkini
    const currentData = [...tradingData];
    
    // 2. Update filtered metrics
    if (dashboardState.dateRange.applied && dashboardState.dateRange.startDate) {
        console.log('📅 Applying saved filter:', dashboardState.dateRange);
        const filteredData = filterDataByDateRange(currentData, 
            dashboardState.dateRange.startDate, 
            dashboardState.dateRange.endDate);
        console.log(`📊 Filtered data: ${filteredData.length} items`);
        updateFilteredMetrics(filteredData);
    } else {
        console.log('📅 No filter applied, showing all data');
        updateFilteredMetrics(currentData);
    }
    
    // 3. Update charts
    console.log('📈 Updating charts...');
    updateCharts();
    
    // 4. Update Phase 2 components
    if (typeof updateAllPhase2Components === 'function') {
        console.log('🎯 Updating Phase 2 components...');
        setTimeout(() => {
            updateAllPhase2Components();
        }, 100);
    }
    
    // 5. Update filter status
    console.log('📝 Updating filter status...');
    updateFilterStatusDisplay();
    
    // 6. Force rebuild positions
    console.log('🏗️ Rebuilding positions...');
    rebuildPositionsFromData();
    
    // 7. Update pending badge
    console.log('📛 Updating pending badge...');
    updatePendingBadge();
    
    console.log('✅ Dashboard refreshed successfully');
}
function hardRefreshDashboard() {
    console.log('💥 HARD REFRESH DASHBOARD - SMART VERSION');
    
    // 1. Pakai data yang SUDAH DIUPDATE di memory
    const currentData = [...tradingData];
    smartSyncPortfolio();
    console.log(`📊 Using ${currentData.length} records from memory`);
    
    // 2. Debug: Tampilkan perubahan saham
    const stockCount = {};
    currentData.forEach(item => {
        stockCount[item.kodeSaham] = (stockCount[item.kodeSaham] || 0) + 1;
    });
    console.log('🔍 Stock distribution:', stockCount);
    
    // 3. Reset dashboard state
    dashboardState.currentFilteredData = [...currentData];
    
    // 4. Rebuild positions
    rebuildPositionsFromData();
    
    // 5. Update metrics
    if (dashboardState.dateRange.applied && dashboardState.dateRange.startDate) {
        const filteredData = filterDataByDateRange(
            currentData, 
            dashboardState.dateRange.startDate, 
            dashboardState.dateRange.endDate
        );
        updateFilteredMetrics(filteredData);
    } else {
        updateFilteredMetrics(currentData);
    }
    
    // 6. Update filter status
    updateFilterStatusDisplay();
    
    // 7. Update charts
    updateCharts();
    
    // 8. ⭐⭐ YANG PALING PENTING: Force update Phase 2 components ⭐⭐
    if (typeof updateAllPhase2Components === 'function') {
        console.log('🎯 Scheduling Phase 2 update...');
        setTimeout(() => {
            console.log('🚀 Executing Phase 2 update...');
            updateAllPhase2Components();
        }, 300);
    } else {
        console.error('❌ updateAllPhase2Components function not found!');
        // Fallback: Update stock table langsung
        if (typeof updateStockTable === 'function') {
            updateStockTable();
        }
    }
    
    // 9. Show notification
    setTimeout(() => {
        showNotification('success', '🔄 Dashboard Diperbarui', 
            `Dashboard telah diperbarui.\n\nData: ${currentData.length} trading`, 
            true);
    }, 500);
    
    console.log('✅ Hard refresh completed');
}
function forceUpdateAllDisplays() {
    console.log('🔄 Force updating all displays...');
    
    // 1. Update report table
    displayTradingData();
    
    // 2. ⭐⭐ PASTIKAN: Panggil hardRefreshDashboard ⭐⭐
    if (typeof hardRefreshDashboard === 'function') {
        hardRefreshDashboard();
    } else {
        // Fallback
        updateHomeSummary();
        updateFilterStatusDisplay();
    }
    
    console.log('✅ All displays force updated');
}


// ================================
// SECTION 10: EVENT LISTENERS
// ================================
// Main Event Listener
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});
// Setup Functions (dipanggil dalam initializeApp)

// ================================
// SECTION 11: eror after refactor
// ================================
// not defined

function addDebugRefreshButton() {
    if (document.getElementById('debug-refresh-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'debug-refresh-btn';
    btn.innerHTML = '🔄 Debug Refresh';
    btn.style.cssText = `
        position: fixed;
        bottom: 70px;
        right: 20px;
        background: #e74c3c;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 15px;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        z-index: 9999;
        box-shadow: 0 2px 8px rgba(231, 76, 60, 0.3);
    `;
    
    btn.addEventListener('click', function() {
        console.log('🔧 DEBUG: Manual refresh triggered');
        console.log('📊 TradingData count:', tradingData.length);
        console.log('📋 All data:', tradingData);
        
        // Panggil hard refresh
        hardRefreshDashboard();
        
        // Show debug info
        const stockCount = {};
        tradingData.forEach(item => {
            stockCount[item.kodeSaham] = (stockCount[item.kodeSaham] || 0) + 1;
        });
        
        alert(`DEBUG INFO:\nTotal data: ${tradingData.length}\nStocks: ${JSON.stringify(stockCount)}`);
    });
    
    document.body.appendChild(btn);
}
async function loadData() {
    try {
        console.log('🔄 Mengambil data dari Google Sheets...');
        updateLoadingStatus('Mengambil data dari Google Sheets...');
        
        const response = await fetch(`${APPS_SCRIPT_URL}?action=getData`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('📦 Response dari server:', result);
        
        if (result.error) {
            console.warn('Server returned warning:', result.error);
            tradingData = [];
            return;
        }
        
        if (result.data && result.data.length > 0) {
            tradingData = result.data.map((row, index) => {
                if (index === 0 && row[0] === 'ID') return null;
                
                return {
                    id: row[0] || generateId(),
                    tanggalMasuk: formatDateForInput(row[1]) || new Date().toISOString().split('T')[0],
                    tanggalKeluar: formatDateForInput(row[2]) || new Date().toISOString().split('T')[0],
                    kodeSaham: row[3] || 'UNKNOWN',
                    hargaMasuk: parseFloat(row[4]) || 0,
                    hargaKeluar: parseFloat(row[5]) || 0,
                    lot: parseInt(row[6]) || 1,
                    feeBuy: parseFloat(row[7]) || 0,
                    feeSell: parseFloat(row[8]) || 0,
                    totalFee: parseFloat(row[9]) || 0,
                    profitLoss: parseFloat(row[10]) || 0,
                    metodeTrading: row[11] || 'Scalping',
                    catatan: row[12] || '',
                    positionData: row[13] ? parsePositionData(row[13]) : null
                };
            }).filter(item => item !== null);
            
            console.log(`✅ Load ${tradingData.length} records berhasil`);
            
            // Rebuild positions dari PositionData
            rebuildPositionsFromData();
        } else {
            tradingData = [];
            console.log('ℹ️ Tidak ada data di Google Sheets');
        }
        
    } catch (error) {
        console.error('❌ Error loading data from server:', error);
        tradingData = [];
        throw error; // Re-throw untuk ditangkap oleh initializeApp
    }
}
function analyzeSahamPerformance() {
    const sahamData = {};
    
    tradingData.forEach(trade => {
        if (!sahamData[trade.kodeSaham]) {
            sahamData[trade.kodeSaham] = {
                totalTrades: 0,
                wins: 0,
                losses: 0,
                totalProfit: 0,
                profits: []
            };
        }
        
        const data = sahamData[trade.kodeSaham];
        data.totalTrades++;
        data.totalProfit += trade.profitLoss;
        data.profits.push(trade.profitLoss);
        
        if (trade.profitLoss > 0) {
            data.wins++;
        } else if (trade.profitLoss < 0) {
            data.losses++;
        }
    });
    
    return sahamData;
}
function toggleComparison(enable) {
    console.log(`🔄 toggleComparison: ${enable ? 'ON' : 'OFF'}`);
    
    dashboardState.comparison.enabled = enable;
    
    const comparisonSection = document.getElementById('comparisonSection');
    if (comparisonSection) {
        comparisonSection.style.display = enable ? 'block' : 'none';
    }
    
    if (enable) {
        calculateComparisonData();
    } else {
        // Clear trend displays
        document.querySelectorAll('.metric-trend').forEach(el => {
            el.textContent = '';
            el.className = 'metric-trend';
        });
    }
    
    saveDashboardState();
}
function setupWithdrawForm() {
    console.log('🔄 setupWithdrawForm: Initializing...');
    
    const form = document.getElementById('withdrawForm');
    if (!form) {
        console.warn('⚠️ Withdraw form not found');
        return () => {}; // Return empty function
    }
    
    // Remove existing listeners
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    // Function untuk update cash info
    const updateCashInfo = () => {
        const availableCash = portfolioData.summary?.availableCash || 0;
        const availableCashEl = document.getElementById('availableCash');
        const maxWithdrawEl = document.getElementById('maxWithdraw');
        
        if (availableCashEl) {
            availableCashEl.textContent = `Rp ${formatNumber(availableCash)}`;
        }
        if (maxWithdrawEl) {
            maxWithdrawEl.textContent = `Rp ${formatNumber(availableCash)}`;
        }
        
        console.log(`💰 Updated cash info: Rp ${formatNumber(availableCash)}`);
    };
    
    // Quick percentage buttons
    document.querySelectorAll('.quick-percent').forEach(btn => {
        btn.addEventListener('click', function() {
            const percent = parseInt(this.getAttribute('data-percent'));
            const availableCash = portfolioData.summary?.availableCash || 0;
            const amount = Math.floor((availableCash * percent) / 100);
            
            document.getElementById('withdrawAmount').value = amount;
            
            // Highlight active button
            document.querySelectorAll('.quick-percent').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            console.log(`📊 Quick ${percent}% selected: Rp ${formatNumber(amount)}`);
        });
    });
    
    // Form submission
    newForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('📝 Withdraw form submitted');
        
        const formData = {
            type: 'WITHDRAW',
            amount: document.getElementById('withdrawAmount').value,
            method: document.getElementById('withdrawMethod').value,
            notes: document.getElementById('withdrawNotes').value
        };
        
        console.log('📋 Form data:', formData);
        
        const result = await addPortfolioTransaction(formData);
        
        if (result && result.success) {
            // Close modal
            document.getElementById('withdrawModal').style.display = 'none';
            // Reset form
            this.reset();
            // Reset quick buttons
            document.querySelectorAll('.quick-percent').forEach(btn => {
                btn.classList.remove('active');
            });
        }
    });
    
    console.log('✅ setupWithdrawForm: Completed');
    return updateCashInfo; // Return the update function
}
async function exportTransactionHistory() {
    console.log('📤 exportTransactionHistory: Exporting data...');
    
    try {
        if (!portfolioData.transactions || portfolioData.transactions.length === 0) {
            showPortfolioNotification('warning', 'Tidak ada data transaksi untuk diexport');
            return;
        }
        
        showPortfolioLoading('Menyiapkan data export...');
        
        // Format data untuk CSV
        const headers = ['Tanggal', 'Waktu', 'Jenis', 'Jumlah', 'Metode', 'Catatan', 'Saldo Setelah'];
        
        const csvData = portfolioData.transactions.map(trans => {
            const date = new Date(trans.timestamp);
            return [
                date.toLocaleDateString('id-ID'),
                date.toLocaleTimeString('id-ID'),
                trans.type,
                trans.type === 'TOP_UP' ? `+${trans.amount}` : `-${trans.amount}`,
                trans.method || '',
                trans.notes || '',
                trans.balanceAfter || 0
            ];
        });
        
        // Tambah summary
        csvData.unshift([]);
        csvData.unshift(['TOTAL TOP UP', portfolioData.summary?.totalTopUp || 0]);
        csvData.unshift(['TOTAL WITHDRAW', portfolioData.summary?.totalWithdraw || 0]);
        csvData.unshift(['TOTAL EQUITY', portfolioData.summary?.totalEquity || 0]);
        csvData.unshift(['AVAILABLE CASH', portfolioData.summary?.availableCash || 0]);
        csvData.unshift(['=== SUMMARY ===']);
        
        // Convert ke CSV
        const csvContent = [
            headers.join(','),
            ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        
        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `portfolio-transactions-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        hidePortfolioLoading();
        console.log('✅ Export completed, file downloaded');
        showPortfolioNotification('success', `Data ${portfolioData.transactions.length} transaksi berhasil diexport`);
        
    } catch (error) {
        console.error('❌ Error exporting transaction history:', error);
        hidePortfolioLoading();
        showPortfolioNotification('error', 'Gagal mengexport data: ' + error.message);
    }
}
function analyzeMetodePerformance() {
    const metodeData = {};
    
    tradingData.forEach(trade => {
        if (!metodeData[trade.metodeTrading]) {
            metodeData[trade.metodeTrading] = {
                totalTrades: 0,
                wins: 0,
                losses: 0,
                totalProfit: 0,
                profits: []
            };
        }
        
        const data = metodeData[trade.metodeTrading];
        data.totalTrades++;
        data.totalProfit += trade.profitLoss;
        data.profits.push(trade.profitLoss);
        
        if (trade.profitLoss > 0) {
            data.wins++;
        } else if (trade.profitLoss < 0) {
            data.losses++;
        }
    });
    
    return metodeData;
}
function updatePerformanceCharts() {
    const metodeData = analyzeMetodePerformance();
    
    // Win Rate Chart
    const winRateCtx = document.getElementById('winRateChart');
    if (winRateCtx) {
        if (winRateChart) winRateChart.destroy();
        
        const methods = Object.keys(metodeData);
        const winRates = methods.map(method => {
            const data = metodeData[method];
            return data.totalTrades > 0 ? (data.wins / data.totalTrades * 100) : 0;
        });
        
        winRateChart = new Chart(winRateCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: methods,
                datasets: [{
                    label: 'Win Rate (%)',
                    data: winRates,
                    backgroundColor: '#3498db'
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });
    }
    
    // Distribution Chart
    const distributionCtx = document.getElementById('distributionChart');
    if (distributionCtx) {
        if (distributionChart) distributionChart.destroy();
        
        const profitRanges = {
            'Loss Besar (< -1M)': 0,
            'Loss Sedang (-1M - -100K)': 0,
            'Loss Kecil (-100K - 0)': 0,
            'Profit Kecil (0 - 100K)': 0,
            'Profit Sedang (100K - 1M)': 0,
            'Profit Besar (> 1M)': 0
        };
        
        tradingData.forEach(trade => {
            const profit = trade.profitLoss;
            if (profit < -1000000) profitRanges['Loss Besar (< -1M)']++;
            else if (profit < -100000) profitRanges['Loss Sedang (-1M - -100K)']++;
            else if (profit < 0) profitRanges['Loss Kecil (-100K - 0)']++;
            else if (profit < 100000) profitRanges['Profit Kecil (0 - 100K)']++;
            else if (profit < 1000000) profitRanges['Profit Sedang (100K - 1M)']++;
            else profitRanges['Profit Besar (> 1M)']++;
        });
        
        distributionChart = new Chart(distributionCtx.getContext('2d'), {
            type: 'pie',
            data: {
                labels: Object.keys(profitRanges),
                datasets: [{
                    data: Object.values(profitRanges),
                    backgroundColor: [
                        '#e74c3c', '#f39c12', '#f1c40f', 
                        '#2ecc71', '#27ae60', '#16a085'
                    ]
                }]
            },
            options: {
                responsive: true
            }
        });
    }
}
async function deleteTradingData(id) {
    const userConfirmed = await showConfirmationModal(
        '🗑️ Hapus Data Trading',
        'Apakah Anda yakin ingin menghapus data trading ini?\n\nTindakan ini tidak dapat dibatalkan.'
    );
    
    if (!userConfirmed) {
        console.log('❌ User cancelled delete operation');
        return;
    }
    
    // Tampilkan loading
    showLoading('Menghapus data dari Google Sheets...');
    
    tradingData = tradingData.filter(item => item.id !== id);
    
    // Simpan perubahan
    await saveData();
    smartSyncPortfolio();
    // Sembunyikan loading
    hideLoading();
    
    // Update tampilan
    // ⭐⭐ PERBAIKAN: Force update semua tampilan ⭐⭐
    forceUpdateAllDisplays();
    // updateHomeSummary();
    // displayTradingData();
    
    showNotification('success', '✅ Data Dihapus', 'Data trading berhasil dihapus dari sistem!', true);
}
async function saveData() {
    console.log('💾 Menyimpan data ke Google Sheets...');
    
    try {
        // ⭐ UPDATE: Sertakan PositionData dalam data yang disimpan
        const dataToSave = tradingData.map(item => ({
            ...item,
            positionData: serializePositionData(item.positionData)
        }));
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'saveAllData',
                jsonData: JSON.stringify(tradingData)
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.error) {
            throw new Error(`Google Sheets error: ${result.error}`);
        }
        
        console.log('✅ Data berhasil disimpan ke Google Sheets');
        return true;
        
    } catch (error) {
        console.error('❌ Gagal menyimpan ke Google Sheets:', error);
        alert('❌ Gagal menyimpan data ke Google Sheets!\n\nError: ' + error.message);
        return false;
    }
}


//TESTING 
// Simpan di console untuk testing
function testPortfolioSync() {
    console.log('🧪 TESTING PORTFOLIO SYNC');
    console.log('='.repeat(50));
    
    // 1. Capture current state
    const beforePL = portfolioData.summary?.totalPL || 0;
    const beforeEquity = portfolioData.summary?.totalEquity || 0;
    const tradeCount = tradingData.length;
    
    console.log('📊 BEFORE:');
    console.log('- Portfolio PL:', formatCurrency(beforePL));
    console.log('- Portfolio Equity:', formatCurrency(beforeEquity));
    console.log('- Trading Records:', tradeCount);
    
    // 2. Calculate expected
    const calculatedPL = tradingData.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    console.log('- Calculated PL from tradingData:', formatCurrency(calculatedPL));
    console.log('- Difference:', formatCurrency(calculatedPL - beforePL));
    
    // 3. Run sync
    console.log('\n🔄 RUNNING SYNC...');
    smartSyncPortfolio();
    
    // 4. Check after
    setTimeout(() => {
        console.log('\n📊 AFTER:');
        console.log('- Portfolio PL:', formatCurrency(portfolioData.summary?.totalPL || 0));
        console.log('- Portfolio Equity:', formatCurrency(portfolioData.summary?.totalEquity || 0));
        console.log('- Match?', portfolioData.summary?.totalPL === Math.round(calculatedPL) ? '✅' : '❌');
        
        // 5. Verify UI
        const uiPL = document.getElementById('totalPL')?.textContent;
        const uiEquity = document.getElementById('totalEquity')?.textContent;
        console.log('\n🎨 UI CHECK:');
        console.log('- UI PL:', uiPL);
        console.log('- UI Equity:', uiEquity);
    }, 500);
}
// Test function
async function testCompletePortfolioFlow() {
    console.log('🧪 TEST COMPLETE PORTFOLIO FLOW');
    
    // 1. Capture initial state
    const initialSheetsPL = await getPortfolioPLFromSheets();
    const initialLocalPL = portfolioData.summary?.totalPL || 0;
    
    console.log('Initial - Sheets PL:', initialSheetsPL, 'Local PL:', initialLocalPL);
    
    // 2. Add test trade
    const testTrade = {
        id: 'TEST-' + Date.now(),
        profitLoss: 50000
    };
    
    tradingData.push(testTrade);
    
    // 3. Trigger sync
    await smartSyncPortfolio();
    
    // 4. Wait and check
    setTimeout(async () => {
        const updatedSheetsPL = await getPortfolioPLFromSheets();
        const updatedLocalPL = portfolioData.summary?.totalPL || 0;
        
        console.log('Updated - Sheets PL:', updatedSheetsPL, 'Local PL:', updatedLocalPL);
        console.log('Expected change: +50,000');
        console.log('Sheets change:', updatedSheetsPL - initialSheetsPL);
        console.log('Local change:', updatedLocalPL - initialLocalPL);
        
        // Cleanup
        tradingData.pop();
        await smartSyncPortfolio();
        
    }, 3000);
}

// Helper function
async function getPortfolioPLFromSheets() {
    try {
        const response = await fetch(`${APPS_SCRIPT_URL}?action=portfolio/getSummary`);
        const data = await response.json();
        return data.summary?.totalPL || 0;
    } catch (error) {
        console.error('Error fetching from Sheets:', error);
        return 0;
    }
}
function testOfflinePortfolioSync() {
    // Simulate offline
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    
    console.log('📴 Testing offline mode...');
    
    // Add trade
    tradingData.push({
        id: 'OFFLINE-TEST',
        profitLoss: 25000
    });
    
    // Trigger sync (should save to pending queue)
    smartSyncPortfolio();
    
    // Check pending queue
    const pending = JSON.parse(localStorage.getItem('portfolio_pending_changes') || '[]');
    console.log('Pending items:', pending.length);
    
    // Restore online
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    
    // Trigger pending sync
    processPendingPortfolioSync();
    
    // Cleanup
    tradingData.pop();
}
