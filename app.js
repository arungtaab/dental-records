// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvPwxiSee3iDYQP49VwNA58uz85GcI4xIdcOaNoko8s9M9mMBTK8SvyDC3744HfPpvdg/exec'; // Replace with your actual Apps Script URL
const DB_NAME = 'DentalOfflineDB';
const DB_VERSION = 4; // Increment for new structure

// ==================== GLOBAL VARIABLES ====================
let db = null;
let currentStudent = null;
let currentRecords = [];
const toothStatus = {};
const toothCategories = {
    extraction: [],
    filling: []
};

// ==================== INDEXEDDB SETUP ====================
async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Delete existing stores
            Array.from(db.objectStoreNames).forEach(storeName => {
                db.deleteObjectStore(storeName);
            });
            
            // Students store
            const studentStore = db.createObjectStore('students', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            studentStore.createIndex('completeName', 'completeName', { unique: false });
            studentStore.createIndex('dob', 'dob', { unique: false });
            studentStore.createIndex('school', 'school', { unique: false });
            
            // Dental records store
            const recordsStore = db.createObjectStore('dentalRecords', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            recordsStore.createIndex('studentId', 'studentId', { unique: false });
            recordsStore.createIndex('timestamp', 'timestamp', { unique: false });
            
            // Pending sync store
            const pendingStore = db.createObjectStore('pendingSync', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
            
            console.log('Database upgraded to version', DB_VERSION);
        };
    });
}

// ==================== SAFE STRING HELPER ====================
function safeString(value) {
    return value === null || value === undefined || value === '' ? '' : String(value).trim();
}

// ==================== DATE FORMATTING ====================
function formatDateForSearch(dateValue) {
    try {
        if (!dateValue) return '';
        if (dateValue instanceof Date) {
            const day = String(dateValue.getDate()).padStart(2, '0');
            const month = String(dateValue.getMonth() + 1).padStart(2, '0');
            const year = dateValue.getFullYear();
            return `${day}/${month}/${year}`;
        }
        return safeString(dateValue);
    } catch (e) {
        return safeString(dateValue);
    }
}

// ==================== SYNC WITH APPS SCRIPT ====================
async function syncWithAppsScript() {
    if (!navigator.onLine) {
        console.log('Offline - cannot sync');
        return;
    }
    
    try {
        await openDB();
        
        // Get pending sync items
        const transaction = db.transaction('pendingSync', 'readonly');
        const store = transaction.objectStore('pendingSync');
        const request = store.getAll();
        
        request.onsuccess = async () => {
            const pending = request.result || [];
            
            if (pending.length === 0) {
                console.log('No pending items to sync');
                return;
            }
            
            console.log(`Syncing ${pending.length} items...`);
            
            for (const item of pending) {
                try {
                    const formData = new FormData();
                    formData.append('action', 'save');
                    formData.append('record', JSON.stringify(item.data));
                    
                    const response = await fetch(APPS_SCRIPT_URL, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (response.ok) {
                        // Delete from pending after successful sync
                        const deleteTx = db.transaction('pendingSync', 'readwrite');
                        const deleteStore = deleteTx.objectStore('pendingSync');
                        await deleteStore.delete(item.id);
                        console.log('Synced item:', item.id);
                    }
                } catch (error) {
                    console.error('Sync failed for item:', item.id, error);
                }
            }
            
            showToast(`✅ Synced ${pending.length} records to Google Sheets`, 'success');
        };
    } catch (error) {
        console.error('Sync error:', error);
    }
}

// ==================== SAVE TO APPS SCRIPT (OR OFFLINE) ====================
async function saveToCloud(data) {
    if (!navigator.onLine) {
        // Save to pending sync
        await openDB();
        const transaction = db.transaction('pendingSync', 'readwrite');
        const store = transaction.objectStore('pendingSync');
        await store.add({
            data: data,
            timestamp: new Date().toISOString()
        });
        showToast('📱 Offline - saved locally, will sync when online', 'offline');
        return { success: true, offline: true };
    }
    
    try {
        const formData = new FormData();
        formData.append('action', 'save');
        formData.append('record', JSON.stringify(data));
        
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Online save failed:', error);
        
        // Save to pending sync
        await openDB();
        const transaction = db.transaction('pendingSync', 'readwrite');
        const store = transaction.objectStore('pendingSync');
        await store.add({
            data: data,
            timestamp: new Date().toISOString()
        });
        showToast('📱 Online save failed - saved locally, will retry later', 'offline');
        return { success: true, offline: true };
    }
}

// ==================== SEARCH STUDENT (CONNECTED TO APPS SCRIPT) ====================
window.searchStudent = async function() {
    console.log('=== SEARCH FUNCTION STARTED ===');
    
    const completeName = document.getElementById('searchName')?.value.trim() || '';
    const dob = document.getElementById('searchDob')?.value.trim() || '';
    const school = document.getElementById('searchSchool')?.value || '';
    
    if (!completeName || !dob || !school) {
        showStatus('searchStatus', 'Please fill in all search fields / Punan ang lahat ng field', 'error');
        return;
    }
    
    // Show loading
    document.getElementById('searchLoading')?.classList.remove('hidden');
    document.getElementById('studentInfo')?.classList.add('hidden');
    document.getElementById('previousRecords')?.classList.add('hidden');
    
    try {
        // First try online search
        if (navigator.onLine) {
            try {
                const formData = new FormData();
                formData.append('action', 'search');
                formData.append('completeName', completeName);
                formData.append('dob', dob);
                formData.append('school', school);
                
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success && result.found) {
                    handleSearchResults(result);
                    document.getElementById('searchLoading')?.classList.add('hidden');
                    return;
                }
            } catch (error) {
                console.log('Online search failed, trying offline:', error);
            }
        }
        
        // If online failed or offline, search in IndexedDB
        await openDB();
        
        const searchName = completeName.toLowerCase().trim();
        const searchDOB = formatDateForSearch(dob);
        const searchSchool = school.toLowerCase().trim();
        
        console.log('Offline search for:', { name: searchName, dob: searchDOB, school: searchSchool });
        
        // Get all students from local DB
        const transaction = db.transaction('students', 'readonly');
        const store = transaction.objectStore('students');
        const request = store.getAll();
        
        request.onsuccess = async () => {
            const allStudents = request.result || [];
            console.log('Total students in local DB:', allStudents.length);
            
            const records = [];
            let totalVisits = 0;
            
            // Find matching students
            for (let i = 0; i < allStudents.length; i++) {
                const student = allStudents[i];
                
                const rowName = (student.completeName || '').toLowerCase().trim();
                const rowDOB = formatDateForSearch(student.dob);
                const rowSchool = (student.school || '').toLowerCase().trim();
                
                if (rowDOB === searchDOB && 
                    rowName === searchName && 
                    rowSchool === searchSchool) {
                    
                    totalVisits++;
                    
                    // Get dental records for this student
                    const recordsTx = db.transaction('dentalRecords', 'readonly');
                    const recordsStore = recordsTx.objectStore('dentalRecords');
                    const recordsIndex = recordsStore.index('studentId');
                    const recordsRequest = recordsIndex.getAll(student.id);
                    
                    await new Promise(resolve => {
                        recordsRequest.onsuccess = () => {
                            const dentalRecords = recordsRequest.result || [];
                            
                            const record = {
                                ...student,
                                visitNumber: totalVisits,
                                ...(dentalRecords.length > 0 ? dentalRecords[dentalRecords.length - 1] : {})
                            };
                            
                            console.log('Offline MATCH FOUND:', record.completeName);
                            records.push(record);
                            resolve();
                        };
                    });
                }
            }
            
            document.getElementById('searchLoading')?.classList.add('hidden');
            
            if (records.length > 0) {
                // Display the first (most recent) record
                displayStudentInfo(records[0]);
                currentStudent = records[0];
                currentRecords = records;
                
                // Show all records if there are multiple
                if (records.length > 1) {
                    displayPreviousRecords(records);
                }
                
                showStatus('searchStatus', `✅ Found ${records.length} local record(s) for ${records[0].completeName}`, 'success');
            } else {
                // Student not found - offer to create new
                if (confirm('❌ Student not found. Create new record? / Walang nakitang mag-aaral. Gumawa ng bagong tala?')) {
                    newStudentEntry(completeName, dob, school);
                } else {
                    showStatus('searchStatus', '❌ Student not found / Walang nakitang mag-aaral', 'error');
                }
            }
        };
        
    } catch (error) {
        console.error('Search error:', error);
        document.getElementById('searchLoading')?.classList.add('hidden');
        showStatus('searchStatus', '❌ Error: ' + error.message, 'error');
    }
};

function handleSearchResults(result) {
    console.log('Online search results:', result);
    
    if (result.records && result.records.length > 0) {
        const student = result.records[0];
        displayStudentInfo(student);
        currentStudent = student;
        currentRecords = result.records;
        
        // Save to local DB for offline use
        saveStudentLocally(student);
        
        if (result.records.length > 1) {
            displayPreviousRecords(result.records);
        }
        
        showStatus('searchStatus', `✅ Found ${result.records.length} record(s) from Google Sheets`, 'success');
    }
}

async function saveStudentLocally(student) {
    try {
        await openDB();
        
        // Check if student exists locally
        const transaction = db.transaction('students', 'readwrite');
        const store = transaction.objectStore('students');
        
        // Add or update student
        await store.put({
            ...student,
            id: student.id || Date.now(),
            timestamp: new Date().toISOString()
        });
        
        console.log('Student saved locally for offline use');
    } catch (error) {
        console.error('Error saving student locally:', error);
    }
}

// ==================== NEW STUDENT ENTRY ====================
function newStudentEntry(name, dob, school) {
    // Pre-fill the form with search data
    document.getElementById('editName').value = name || '';
    document.getElementById('editDob').value = dob || '';
    document.getElementById('editSchool').value = school || '';
    
    // Show the student form
    document.getElementById('studentForm').classList.remove('hidden');
    document.getElementById('selectedStudentName').textContent = 'New Student / Bagong Mag-aaral';
    
    // Switch to dental exam tab
    switchTab(2);
}

// ==================== DISPLAY STUDENT INFO ====================
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
    
    // Also populate the edit form
    document.getElementById('editName').value = student.completeName || '';
    document.getElementById('editSex').value = student.sex || '';
    document.getElementById('editAge').value = student.age || '';
    document.getElementById('editDob').value = student.dob || '';
    document.getElementById('editAddress').value = student.address || '';
    document.getElementById('editSchool').value = student.school || '';
    document.getElementById('editParent').value = student.parentName || '';
    document.getElementById('editContact').value = student.contactNumber || '';
    document.getElementById('editSystemic').value = student.systemicConditions || '';
    document.getElementById('editFoodAllergy').value = student.allergiesFood || '';
    document.getElementById('editMedAllergy').value = student.allergiesMedicines || '';
    
    document.getElementById('selectedStudentName').textContent = student.completeName || '';
    document.getElementById('studentInfo').classList.remove('hidden');
    document.getElementById('studentForm').classList.remove('hidden');
}

// ==================== DISPLAY PREVIOUS RECORDS ====================
function displayPreviousRecords(records) {
    const recordsList = document.getElementById('recordsList');
    const previousRecords = document.getElementById('previousRecords');
    
    if (!recordsList || !previousRecords) return;
    
    recordsList.innerHTML = '';
    
    // Skip the first (most recent) since it's already displayed
    for (let i = 1; i < records.length; i++) {
        const record = records[i];
        const div = document.createElement('div');
        div.className = 'record-item';
        div.onclick = () => loadPreviousRecord(record);
        div.innerHTML = `
            <div class="record-date">${new Date(record.timestamp).toLocaleDateString()}</div>
            <div>Visit #${record.visitNumber}</div>
            <div>Extraction: ${record.toothExtraction || 'None'}</div>
            <div>Filling: ${record.toothFilling || 'None'}</div>
        `;
        recordsList.appendChild(div);
    }
    
    previousRecords.classList.remove('hidden');
}

function loadPreviousRecord(record) {
    if (confirm('Load this previous record? Current unsaved data will be lost.')) {
        displayStudentInfo(record);
        showToast('Loaded previous record', 'info');
    }
}

// ==================== SAVE STUDENT INFO ====================
window.saveStudentInfo = async function() {
    const student = {
        completeName: document.getElementById('editName').value,
        sex: document.getElementById('editSex').value,
        age: document.getElementById('editAge').value,
        dob: document.getElementById('editDob').value,
        address: document.getElementById('editAddress').value,
        school: document.getElementById('editSchool').value,
        parentName: document.getElementById('editParent').value,
        contactNumber: document.getElementById('editContact').value,
        systemicConditions: document.getElementById('editSystemic').value,
        allergiesFood: document.getElementById('editFoodAllergy').value,
        allergiesMedicines: document.getElementById('editMedAllergy').value,
        timestamp: new Date().toISOString()
    };
    
    if (!student.completeName || !student.dob || !student.school) {
        showToast('Please fill required fields', 'error');
        return;
    }
    
    try {
        await openDB();
        
        const transaction = db.transaction('students', 'readwrite');
        const store = transaction.objectStore('students');
        
        if (currentStudent && currentStudent.id) {
            student.id = currentStudent.id;
            const request = store.put(student);
            request.onsuccess = () => {
                showToast('Student info updated!', 'success');
                displayStudentInfo(student);
                currentStudent = student;
                
                // Sync to cloud if online
                if (navigator.onLine) {
                    saveToCloud({ ...student, action: 'saveStudent' });
                }
            };
        } else {
            const request = store.add(student);
            request.onsuccess = (e) => {
                student.id = e.target.result;
                showToast('New student saved!', 'success');
                displayStudentInfo(student);
                currentStudent = student;
                
                // Sync to cloud if online
                if (navigator.onLine) {
                    saveToCloud({ ...student, action: 'saveStudent' });
                }
            };
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Error saving student', 'error');
    }
};

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
        btn.className = 'tooth-btn normal';
        btn.querySelector('.status').textContent = 'N';
    });
    updateToothCategories();
}

// ==================== SAVE DENTAL RECORD ====================
document.getElementById('dentalExamForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!currentStudent) {
        showToast('Please search for a student first', 'error');
        switchTab(1);
        return;
    }
    
    const record = {
        studentId: currentStudent.id,
        studentName: currentStudent.completeName,
        toothExtraction: document.getElementById('toothExtraction')?.value || '',
        toothFilling: document.getElementById('toothFilling')?.value || '',
        toothCleaning: document.getElementById('toothCleaning')?.value || '',
        fluoride: document.getElementById('fluoride')?.value || '',
        dentalConsult: document.getElementById('dentalConsult')?.value || '',
        severeCavities: document.getElementById('severeCavities')?.value || '',
        oralNotes: document.getElementById('oralNotes')?.value || '',
        cleaningNotes: document.getElementById('cleaningNotes')?.value || '',
        remarks: document.getElementById('remarks')?.value || '',
        toothData: { ...toothStatus },
        timestamp: new Date().toISOString()
    };
    
    try {
        // Save locally first
        await openDB();
        
        const transaction = db.transaction('dentalRecords', 'readwrite');
        const store = transaction.objectStore('dentalRecords');
        const request = store.add(record);
        
        request.onsuccess = () => {
            showToast('✅ Dental record saved locally!', 'success');
            
            // Try to sync to cloud
            saveToCloud({ ...record, action: 'saveDental' });
            
            e.target.reset();
            resetTeeth();
        };
        
        request.onerror = () => {
            showToast('❌ Error saving record', 'error');
        };
    } catch (error) {
        console.error('Save error:', error);
        showToast('❌ Error saving record', 'error');
    }
});

// ==================== UI FUNCTIONS ====================
function switchTab(tabNumber) {
    document.querySelectorAll('.tab').forEach((tab, i) => {
        if (i === tabNumber - 1) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.tab-content').forEach((content, i) => {
        if (i === tabNumber - 1) {
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
        'error': '#dc3545',
        'info': '#333',
        'offline': '#ffc107',
        'warning': '#ffc107'
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
        syncWithAppsScript();
    } else {
        statusDiv.className = 'status offline';
        statusIcon.textContent = '📴';
        statusText.textContent = 'You are offline / Offline ka - saving locally';
    }
}

window.clearSearch = function() {
    document.getElementById('searchName').value = '';
    document.getElementById('searchDob').value = '';
    document.getElementById('searchSchool').value = '';
    
    document.getElementById('studentInfo').classList.add('hidden');
    document.getElementById('previousRecords').classList.add('hidden');
    document.getElementById('studentForm').classList.add('hidden');
    
    const searchStatus = document.getElementById('searchStatus');
    if (searchStatus) {
        searchStatus.classList.add('hidden');
    }
    
    resetTeeth();
    
    const form = document.getElementById('dentalExamForm');
    if (form) form.reset();
    document.getElementById('toothExtraction').value = '';
    document.getElementById('toothFilling').value = '';
    document.getElementById('toothCleaning').value = '';
    
    showToast('✨ Form cleared / Na-clear ang form', 'info');
};

// ==================== INITIALIZATION ====================
window.onload = async function() {
    console.log('Page loaded, initializing...');
    
    await openDB();
    initTeeth();
    populateTeeth();
    updateOnlineStatus();
    
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    
    // Try to sync when page loads
    if (navigator.onLine) {
        syncWithAppsScript();
    }
    
    // Check for service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker error:', err));
    }
};
