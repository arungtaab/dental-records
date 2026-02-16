// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'YOUR_WEB_APP_URL_HERE'; // Replace with your Apps Script URL
const DB_NAME = 'DentalOfflineDB';
const DB_VERSION = 1;

// ==================== GLOBAL VARIABLES ====================
let db = null;
let currentStudent = null;
const toothStatus = {};
const toothCategories = {
    extraction: [],
    filling: []
};

// ==================== INDEXEDDB SETUP ====================
async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('Database error:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('Database opened successfully');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains('pending')) {
                const store = db.createObjectStore('pending', { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                store.createIndex('timestamp', 'timestamp');
                store.createIndex('synced', 'synced');
            }
            
            if (!db.objectStoreNames.contains('students')) {
                const store = db.createObjectStore('students', { 
                    keyPath: 'studentId' 
                });
                store.createIndex('name', 'name');
                store.createIndex('school', 'school');
            }
            
            console.log('Database setup complete');
        };
    });
}

// ==================== OFFLINE STORAGE ====================
async function saveRecordOffline(record) {
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
            updatePendingCount();
            resolve({ success: true, id: request.result });
        };
        
        request.onerror = () => {
            console.error('Error saving offline:', request.error);
            reject(request.error);
        };
    });
}

async function getPendingRecords() {
    await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('pending', 'readonly');
        const store = transaction.objectStore('pending');
        const index = store.index('synced');
        const request = index.getAll(false);
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function deletePendingRecord(id) {
    await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('pending', 'readwrite');
        const store = transaction.objectStore('pending');
        const request = store.delete(id);
        
        request.onsuccess = () => {
            resolve(true);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function updatePendingCount() {
    const pending = await getPendingRecords();
    const pendingCount = document.getElementById('pendingCount');
    const syncBtn = document.getElementById('syncBtn');
    
    if (pending.length > 0) {
        pendingCount.textContent = pending.length;
        pendingCount.classList.remove('hidden');
        if (syncBtn) syncBtn.classList.remove('hidden');
    } else {
        pendingCount.classList.add('hidden');
        if (syncBtn) syncBtn.classList.add('hidden');
    }
}

// ==================== SYNC WITH GOOGLE SHEETS ====================
async function syncWithGoogleSheets() {
    if (!navigator.onLine) {
        showToast('📴 You are offline. Cannot sync. / Offline ka. Hindi maka-sync.', 'offline');
        return;
    }
    
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
    
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        statusIndex = (statusIndex + 1) % statuses.length;
        const newStatus = statuses[statusIndex];
        
        btn.className = `tooth-btn ${getStatusClass(newStatus)}`;
        btn.innerHTML = `<span class="number">${toothNumber}</span><span class="status">${newStatus}</span>`;
        
        toothStatus[toothNumber] = newStatus;
        updateToothCategories();
    });
    
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
    
    document.getElementById('toothExtraction').value = toothCategories.extraction.join(', ');
    document.getElementById('toothFilling').value = toothCategories.filling.join(', ');
}

function populateTeeth() {
    document.getElementById('upperRightPerm').innerHTML = '';
    [18,17,16,15,14,13,12,11].forEach(tooth => {
        document.getElementById('upperRightPerm').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('upperLeftPerm').innerHTML = '';
    [21,22,23,24,25,26,27,28].forEach(tooth => {
        document.getElementById('upperLeftPerm').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('lowerLeftPerm').innerHTML = '';
    [38,37,36,35,34,33,32,31].forEach(tooth => {
        document.getElementById('lowerLeftPerm').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('lowerRightPerm').innerHTML = '';
    [41,42,43,44,45,46,47,48].forEach(tooth => {
        document.getElementById('lowerRightPerm').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('upperRightBaby').innerHTML = '';
    [55,54,53,52,51].forEach(tooth => {
        document.getElementById('upperRightBaby').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('upperLeftBaby').innerHTML = '';
    [61,62,63,64,65].forEach(tooth => {
        document.getElementById('upperLeftBaby').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('lowerLeftBaby').innerHTML = '';
    [75,74,73,72,71].forEach(tooth => {
        document.getElementById('lowerLeftBaby').appendChild(createToothButton(tooth));
    });
    
    document.getElementById('lowerRightBaby').innerHTML = '';
    [81,82,83,84,85].forEach(tooth => {
        document.getElementById('lowerRightBaby').appendChild(createToothButton(tooth));
    });
}

function resetTeeth() {
    const allTeeth = [
        18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
        38,37,36,35,34,33,32,31,41,42,43,44,45,46,47,48,
        55,54,53,52,51,61,62,63,64,65,
        75,74,73,72,71,81,82,83,84,85
    ];
    
    allTeeth.forEach(tooth => {
        toothStatus[tooth] = 'N';
    });
    
    document.querySelectorAll('.tooth-btn').forEach(btn => {
        const toothNum = btn.querySelector('.number').textContent;
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
    toast.textContent = message;
    toast.className = 'toast';
    
    if (type === 'success') toast.style.background = '#28a745';
    if (type === 'offline') toast.style.background = '#ffc107';
    if (type === 'syncing') toast.style.background = '#17a2b8';
    if (type === 'error') toast.style.background = '#dc3545';
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function updateOnlineStatus() {
    const statusDiv = document.getElementById('connectionStatus');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    
    if (navigator.onLine) {
        statusDiv.className = 'status online';
        statusIcon.textContent = '✅';
        statusText.textContent = 'You are online / Online ka';
        
        // Try to sync when coming online
        setTimeout(syncWithGoogleSheets, 2000);
    } else {
        statusDiv.className = 'status offline';
        statusIcon.textContent = '📴';
        statusText.textContent = 'You are offline / Offline ka - saving locally';
    }
}

// ==================== SEARCH FUNCTION ====================
window.searchStudent = async function() {
    const name = document.getElementById('searchName').value.trim();
    const dob = document.getElementById('searchDob').value.trim();
    const school = document.getElementById('searchSchool').value;
    
    if (!name || !dob || !school) {
        showStatus('searchStatus', 'Please fill in all search fields / Punan ang lahat ng field', 'error');
        return;
    }
    
    document.getElementById('searchLoading').classList.remove('hidden');
    document.getElementById('studentInfo').classList.add('hidden');
    document.getElementById('previousRecords').classList.add('hidden');
    
    try {
        if (navigator.onLine) {
            const formData = new FormData();
            formData.append('action', 'search');
            formData.append('completeName', name);
            formData.append('dob', dob);
            formData.append('school', school);
            
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: formData
            });
            
            const text = await response.text();
            console.log('Search response:', text);
            
            let result;
            try {
                result = JSON.parse(text);
            } catch (e) {
                result = { found: false };
            }
            
            if (result.found && result.records && result.records.length > 0) {
                displayStudentInfo(result.records[0]);
            } else {
                showStatus('searchStatus', '❌ Student not found / Walang nakitang mag-aaral', 'error');
            }
        } else {
            // Search in local IndexedDB when offline
            await openDB();
            const transaction = db.transaction('students', 'readonly');
            const store = transaction.objectStore('students');
            const index = store.index('name');
            const request = index.getAll(name);
            
            request.onsuccess = () => {
                const matches = request.result.filter(s => 
                    s.dob === dob && s.school === school
                );
                
                if (matches.length > 0) {
                    displayStudentInfo(matches[0]);
                } else {
                    showStatus('searchStatus', '❌ Student not found offline / Walang nakitang offline record', 'error');
                }
            };
        }
    } catch (error) {
        console.error('Search error:', error);
        showStatus('searchStatus', '❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('searchLoading').classList.add('hidden');
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
    showStatus('searchStatus', '✅ Student found! / Natagpuan ang mag-aaral!', 'success');
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
    
    document.getElementById('dentalForm')?.reset();
    document.getElementById('toothExtraction').value = '';
    document.getElementById('toothFilling').value = '';
    document.getElementById('toothCleaning').value = '';
    
    showToast('✨ Form cleared / Na-clear ang form', 'info');
};

window.syncPendingRecords = syncWithGoogleSheets;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Page loaded, initializing...');
    
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
