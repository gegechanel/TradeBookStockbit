// ================================
// SECTION 9: INITIALIZATION
// ================================
import { APPS_SCRIPT_URL, PENDING_STORAGE_KEY } from './config.js';
import { tradingData, dashboardState, chartState, portfolioData } from './state.js';
import { tradingData, dashboardState } from './state.js';
import { formatCurrency, formatDate, calculateProfitLoss } from './utilitiy.js';
import { smartSaveData } from './sync.js';
import { rebuildPositionsFromData } from './position.js';
import { updateCharts } from './charts.js';
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
