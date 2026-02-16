// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvPwxiSee3iDYQP49VwNA58uz85GcI4xIdcOaNoko8s9M9mMBTK8SvyDC3744HfPpvdg/exec'; // Replace with your Apps Script URL
const DB_NAME = 'DentalOfflineDB';
const DB_VERSION = 3; // Incremented to force upgrade

// ==================== GLOBAL VARIABLES ====================
let db = null;
let currentStudent = null;
let dbInitPromise = null; // Prevent multiple initializations
const toothStatus = {};
const toothCategories = {
    extraction: [],
    filling: []
};

// ==================== INDEXEDDB SETUP ====================
async function openDB() {
    // Return existing promise if already initializing
    if (dbInitPromise) {
        return dbInitPromise;
    }
    
    dbInitPromise = new Promise((resolve, reject) => {
        console.log('Opening database...');
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('Database error:', request.error);
            dbInitPromise = null;
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('Database opened successfully');
            
            // Handle database close events
            db.onclose = () => {
                console.log('Database closed, resetting connection');
                db = null;
                dbInitPromise = null;
            };
            
            db.onversionchange = () => {
                db.close();
                db = null;
                dbInitPromise = null;
                console.log('Database version changed, reopening...');
            };
            
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('Upgrading database from version', event.oldVersion, 'to', event.newVersion);
            
            // Delete existing stores to ensure clean slate
            const storeNames = Array.from(db.objectStoreNames);
            storeNames.forEach(storeName => {
                db.deleteObjectStore(storeName);
                console.log('Deleted store:', storeName);
            });
            
            // Create pending store
            const pendingStore = db.createObjectStore('pending', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            console.log('Created pending store');
            
            // Create students store with indexes
            const studentStore = db.createObjectStore('students', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            studentStore.createIndex('name', 'name', { unique: false });
            studentStore.createIndex('school', 'school', { unique: false });
            studentStore.createIndex('dob', 'dob', { unique: false });
            console.log('Created students store with indexes');
        };
    });
    
    return dbInitPromise;
}

// ==================== OFFLINE STORAGE ====================
async function saveRecordOffline(record) {
    try {
        await openDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('pending', 'readwrite');
            const store = transaction.objectStore('pending');
            
            const recordToSave = {
                ...record,
                timestamp: new Date().toISOString(),
                synced: false
            };
            
            const request = store.add(recordToSave);
            
            request.onsuccess = () => {
                console.log('Record saved offline with ID:', request.result);
                updatePendingCount().catch(console.error);
                resolve({ success: true, id: request.result });
            };
            
            request.onerror = () => {
                console.error('Error saving offline:', request.error);
                reject(request.error);
            };
            
            transaction.oncomplete = () => {
                console.log('Transaction completed');
            };
        });
    } catch (error) {
        console.error('Failed to save offline:', error);
        throw error;
    }
}

async function getPendingRecords() {
    try {
        await openDB();
        
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = db.transaction('pending', 'readonly');
            const store = transaction.objectStore('pending');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const allRecords = request.result || [];
                const unsynced = allRecords.filter(record => !record.synced);
                resolve(unsynced);
            };
            
            request.onerror = () => {
                console.error('Error getting pending records:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Failed to get pending records:', error);
        return [];
    }
}

async function deletePendingRecord(id) {
    try {
        await openDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('pending', 'readwrite');
            const store = transaction.objectStore('pending');
            const request = store.delete(id);
            
            request.onsuccess = () => {
                console.log('Deleted pending record:', id);
                resolve(true);
            };
            
            request.onerror = () => {
                console.error('Error deleting record:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Failed to delete record:', error);
        throw error;
    }
}

async function updatePendingCount() {
    try {
        const pending = await getPendingRecords();
        const pendingCount = document.getElementById('pendingCount');
        const syncBtn = document.getElementById('syncBtn');
        
        if (pendingCount && syncBtn) {
            if (pending.length > 0) {
                pendingCount.textContent = pending.length;
                pendingCount.classList.remove('hidden');
                syncBtn.classList.remove('hidden');
            } else {
                pendingCount.classList.add('hidden');
                syncBtn.classList.add('hidden');
            }
        }
    } catch (error) {
        console.error('Error updating pending count:', error);
    }
}

// ==================== SYNC WITH GOOGLE SHEETS ====================
async function syncWithGoogleSheets() {
    if (!navigator.onLine) {
        showToast('📴 You are offline. Cannot sync. / Offline ka. Hindi maka-sync.', 'offline');
        return;
    }
    
    try {
        const pendingRecords = await getPendingRecords();
        
        if (pendingRecords.length === 0) {
            showToast('✅ No pending records to sync / Walang pending na tala', 'success');
            return;
        }
        
        showToast(`🔄 Syncing ${pendingRecords.length} records...`, 'syncing');
        
        let successCount = 0;
        let failCount = 0;
        
        for (const record of pendingRecords) {
            try {
                const formData = new FormData();
                formData.append('action', 'save');
                formData.append('record', JSON.stringify(record));
                
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    await deletePendingRecord(record.id);
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error('Sync failed for record', record.id, error);
                failCount++;
            }
        }
        
        await updatePendingCount();
        
        if (failCount === 0) {
            showToast(`✅ Successfully synced ${successCount} records!`, 'success');
        } else {
            showToast(`⚠️ Synced ${successCount}, failed ${failCount}`, 'warning');
        }
    } catch (error) {
        console.error('Sync error:', error);
        showToast('❌ Sync failed: ' + error.message, 'error');
    }
}

// ==================== TEETH FUNCTIONS ====================
function initTeeth() {
    const allTeeth = [
        18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
        38,37,36,35,34,33,32,31,41,42,43,44,45,46,47,48,
        55,54,53,52,51,61,62,63,64,65,
        75,74,73,72,71,81,82,83,84,85
    ];
    
    allTeeth.forEach(tooth => {
        toothStatus[tooth] = 'N';
    });
}

function createToothButton(toothNumber) {
    const btn = document.createElement('button');
    btn.className = 'tooth-btn normal';
    btn.innerHTML = `<span class="number">${toothNumber}</span><span class="status">N</span>`;
    
    const statuses = ['N', 'X', 'O', 'M', 'F'];
    let statusIndex = 0;
    
    const handleToothClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        statusIndex = (statusIndex + 1) % statuses.length;
        const newStatus = statuses[statusIndex];
        
        btn.className = `tooth-btn ${getStatusClass(newStatus)}`;
        btn.innerHTML = `<span class="number">${toothNumber}</span><span class="status">${newStatus}</span>`;
        
        toothStatus[toothNumber] = newStatus;
        updateToothCategories();
    };
    
    btn.addEventListener('click', handleToothClick);
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    return btn;
}

function getStatusClass(status) {
    const classes = {
        'N': 'normal',
        'X': 'extract',
        'O': 'decayed',
        'M': 'missing',
        'F': 'filled'
    };
    return classes[status] || 'normal';
}

function updateToothCategories() {
    toothCategories.extraction = [];
    toothCategories.filling = [];
    
    Object.entries(toothStatus).forEach(([tooth, status]) => {
        if (status === 'X') toothCategories.extraction.push(tooth);
        if (status === 'F' || status === 'O') toothCategories.filling.push(tooth);
    });
    
    const extractionField = document.getElementById('toothExtraction');
    const fillingField = document.getElementById('toothFilling');
    
    if (extractionField) extractionField.value = toothCategories.extraction.join(', ');
    if (fillingField) fillingField.value = toothCategories.filling.join(', ');
}

function populateTeeth() {
    const quadrants = [
        'upperRightPerm', 'upperLeftPerm', 'lowerLeftPerm', 'lowerRightPerm',
        'upperRightBaby', 'upperLeftBaby', 'lowerLeftBaby', 'lowerRightBaby'
    ];
    
    const toothSets = [
        [18,17,16,15,14,13,12,11],
        [21,22,23,24,25,26,27,28],
        [38,37,36,35,34,33,32,31],
        [41,42,43,44,45,46,47,48],
        [55,54,53,52,51],
        [61,62,63,64,65],
        [75,74,73,72,71],
        [81,82,83,84,85]
    ];
    
    quadrants.forEach((quadrantId, index) => {
        const container = document.getElementById(quadrantId);
        if (container) {
            container.innerHTML = '';
            toothSets[index].forEach(tooth => {
                container.appendChild(createToothButton(tooth));
            });
        }
    });
}

function resetTeeth() {
    initTeeth();
    
    document.querySelectorAll('.tooth-btn').forEach(btn => {
        const toothNum = parseInt(btn.querySelector('.number').textContent);
        btn.className = 'tooth-btn normal';
        btn.querySelector('.status').textContent = 'N';
    });
    
    updateToothCategories();
}

// ==================== UI FUNCTIONS ====================
function switchTab(tabNumber) {
    document.querySelectorAll('.tab').forEach((tab, index) => {
        if (index === tabNumber - 1) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.tab-content').forEach((content, index) => {
        if (index === tabNumber - 1) {
            content.classList.remove('hidden');
        } else {
            content.classList.add('hidden');
        }
    });
}

function showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    if (element) {
        element.className = `status ${type}`;
        element.textContent = message;
        element.classList.remove('hidden');
        
        setTimeout(() => {
            element.classList.add('hidden');
        }, 5000);
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = 'toast';
    
    const colors = {
        'success': '#28a745',
        'offline': '#ffc107',
        'syncing': '#17a2b8',
        'error': '#dc3545',
        'info': '#333'
    };
    
    toast.style.background = colors[type] || colors.info;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function updateOnlineStatus() {
    const statusDiv = document.getElementById('connectionStatus');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    
    if (!statusDiv || !statusIcon || !statusText) return;
    
    if (navigator.onLine) {
        statusDiv.className = 'status online';
        statusIcon.textContent = '✅';
        statusText.textContent = 'You are online / Online ka';
        
        // Try to sync when coming online
        setTimeout(() => {
            syncWithGoogleSheets().catch(console.error);
        }, 2000);
    } else {
        statusDiv.className = 'status offline';
        statusIcon.textContent = '📴';
        statusText.textContent = 'You are offline / Offline ka - saving locally';
    }
}

// ==================== SEARCH FUNCTION ====================
window.searchStudent = async function() {
    const name = document.getElementById('searchName')?.value.trim();
    const dob = document.getElementById('searchDob')?.value.trim();
    const school = document.getElementById('searchSchool')?.value;
    
    if (!name || !dob || !school) {
        showStatus('searchStatus', 'Please fill in all search fields / Punan ang lahat ng field', 'error');
        return;
    }
    
    const loading = document.getElementById('searchLoading');
    const studentInfo = document.getElementById('studentInfo');
    const previousRecords = document.getElementById('previousRecords');
    
    if (loading) loading.classList.remove('hidden');
    if (studentInfo) studentInfo.classList.add('hidden');
    if (previousRecords) previousRecords.classList.add('hidden');
    
    try {
        // Mock data for testing
        setTimeout(() => {
            displayStudentInfo({
                completeName: name,
                dob: dob,
                school: school,
                sex: 'Male / Lalaki',
                age: '8',
                parentName: 'Maria Santos',
                contactNumber: '09123456789',
                systemicConditions: 'None / Wala',
                allergiesFood: 'None / Wala',
                allergiesMedicines: 'Penicillin'
            });
            
            if (loading) loading.classList.add('hidden');
            showStatus('searchStatus', '✅ Student found! / Natagpuan ang mag-aaral!', 'success');
        }, 1000);
        
    } catch (error) {
        console.error('Search error:', error);
        if (loading) loading.classList.add('hidden');
        showStatus('searchStatus', '❌ Error: ' + error.message, 'error');
    }
};

function displayStudentInfo(student) {
    document.getElementById('displayName').textContent = student.completeName || '';
    document.getElementById('displayDob').textContent = student.dob || '';
    document.getElementById('displaySex').textContent = student.sex || '';
    document.getElementById('displayAge').textContent = student.age || '';
    document.getElementById('displaySchool').textContent = student.school || '';
    document.getElementById('displayParent').textContent = student.parentName || '';
    document.getElementById('displayContact').textContent = student.contactNumber || '';
    document.getElementById('displaySystemic').textContent = student.systemicConditions || 'None / Wala';
    document.getElementById('displayFoodAllergy').textContent = student.allergiesFood || 'None / Wala';
    document.getElementById('displayMedAllergy').textContent = student.allergiesMedicines || 'None / Wala';
    
    document.getElementById('studentInfo').classList.remove('hidden');
}

window.clearSearch = function() {
    document.getElementById('searchName').value = '';
    document.getElementById('searchDob').value = '';
    document.getElementById('searchSchool').value = '';
    
    document.getElementById('studentInfo').classList.add('hidden');
    document.getElementById('previousRecords').classList.add('hidden');
    
    const searchStatus = document.getElementById('searchStatus');
    if (searchStatus) {
        searchStatus.classList.add('hidden');
    }
    
    resetTeeth();
    
    const form = document.getElementById('dentalForm');
    if (form) form.reset();
    document.getElementById('toothExtraction').value = '';
    document.getElementById('toothFilling').value = '';
    document.getElementById('toothCleaning').value = '';
    
    showToast('✨ Form cleared / Na-clear ang form', 'info');
};

window.syncPendingRecords = syncWithGoogleSheets;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Page loaded, initializing...');
    
    try {
        await openDB();
        initTeeth();
        populateTeeth();
        updateOnlineStatus();
        await updatePendingCount();
        
        // Check online status and sync if needed
        if (navigator.onLine) {
            const pending = await getPendingRecords();
            if (pending.length > 0) {
                showToast(`📤 Found ${pending.length} pending records to sync`, 'syncing');
                setTimeout(syncWithGoogleSheets, 3000);
            }
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('⚠️ Database initialization error', 'error');
    }
    
    // Monitor online/offline status
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    
    // Form submit handler
    document.getElementById('dentalForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const record = {
            studentName: document.getElementById('displayName')?.textContent || '',
            school: document.getElementById('displaySchool')?.textContent || '',
            toothExtraction: document.getElementById('toothExtraction')?.value || '',
            toothFilling: document.getElementById('toothFilling')?.value || '',
            toothCleaning: document.getElementById('toothCleaning')?.value || '',
            fluoride: document.getElementById('fluoride')?.value || '',
            dentalConsult: document.getElementById('dentalConsult')?.value || '',
            severeCavities: document.getElementById('severeCavities')?.value || '',
            oralNotes: document.getElementById('oralNotes')?.value || '',
            cleaningNotes: document.getElementById('cleaningNotes')?.value || '',
            remarks: document.getElementById('remarks')?.value || '',
            toothData: toothStatus
        };
        
        if (navigator.onLine) {
            try {
                const formData = new FormData();
                formData.append('action', 'save');
                formData.append('record', JSON.stringify(record));
                
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    showToast('✅ Record saved to Google Sheets!', 'success');
                    e.target.reset();
                    resetTeeth();
                } else {
                    await saveRecordOffline(record);
                }
            } catch (error) {
                console.log('Online save failed, saving offline:', error);
                await saveRecordOffline(record);
            }
        } else {
            await saveRecordOffline(record);
        }
    });
    
    // Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker error:', err));
    }
});
