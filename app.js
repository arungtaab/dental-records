// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvPwxiSee3iDYQP49VwNA58uz85GcI4xIdcOaNoko8s9M9mMBTK8SvyDC3744HfPpvdg/exec';
const DB_NAME = 'DentalOfflineDB';
const DB_VERSION = 9; // increment to ensure fresh stores

// ==================== GLOBAL VARIABLES ====================
let db = null;
let currentStudent = null;
let currentStudentId = null;
let dbInitPromise = null;
const toothStatus = {};
const toothCategories = { extraction: [], filling: [] };

// ==================== INDEXEDDB SETUP ====================
async function openDB() {
    if (dbInitPromise) return dbInitPromise;
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
            db.onclose = () => {
                console.log('Database closed, resetting connection');
                db = null;
                dbInitPromise = null;
            };
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('Upgrading database from', event.oldVersion, 'to', event.newVersion);
            Array.from(db.objectStoreNames).forEach(name => db.deleteObjectStore(name));

            const studentStore = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
            studentStore.createIndex('name', 'name', { unique: false });
            studentStore.createIndex('dob', 'dob', { unique: false });
            studentStore.createIndex('school', 'school', { unique: false });

            const examStore = db.createObjectStore('exams', { keyPath: 'id', autoIncrement: true });
            examStore.createIndex('studentId', 'studentId', { unique: false });
            examStore.createIndex('date', 'date', { unique: false });

            db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
            console.log('Database stores created');
        };
    });
    return dbInitPromise;
}

// ==================== OFFLINE HELPERS ====================
async function savePending(data) {
    await openDB();
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    return new Promise((resolve, reject) => {
        const record = { data, timestamp: new Date().toISOString(), synced: false };
        const req = store.add(record);
        req.onsuccess = () => { updatePendingCount(); resolve(req.result); };
        req.onerror = () => reject(req.error);
    });
}

async function getPending() {
    await openDB();
    const tx = db.transaction('pending', 'readonly');
    const store = tx.objectStore('pending');
    const req = store.getAll();
    return new Promise(resolve => {
        req.onsuccess = () => resolve(req.result.filter(r => !r.synced));
        req.onerror = () => resolve([]);
    });
}

async function deletePending(id) {
    await openDB();
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => { updatePendingCount(); resolve(); };
        req.onerror = () => reject(req.error);
    });
}

async function updatePendingCount() {
    const pending = await getPending();
    const el = document.getElementById('pendingCount');
    const syncBtn = document.getElementById('syncBtn');
    if (el && syncBtn) {
        if (pending.length) {
            el.textContent = pending.length;
            el.classList.remove('hidden');
            syncBtn.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
            syncBtn.classList.add('hidden');
        }
    }
}

// ==================== SYNC WITH GOOGLE SHEETS ====================
async function syncWithGoogleSheets() {
    if (!navigator.onLine) {
        showToast('📴 Offline – cannot sync', 'offline');
        return;
    }
    const pending = await getPending();
    if (!pending.length) {
        showToast('✅ Nothing to sync', 'success');
        return;
    }
    showToast(`🔄 Syncing ${pending.length}...`, 'syncing');
    let success = 0, fail = 0;
    for (const item of pending) {
        try {
            const formData = new FormData();
            formData.append('action', 'save');
            formData.append('record', JSON.stringify(item.data));
            const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: formData });
            if (res.ok) {
                await deletePending(item.id);
                success++;
            } else {
                const errText = await res.text();
                console.error('Sync error response:', errText);
                fail++;
            }
        } catch (e) {
            console.error(e);
            fail++;
        }
    }
    showToast(`✅ Synced ${success}, failed ${fail}`, fail ? 'warning' : 'success');
    updatePendingCount();
}

// ==================== TEETH FUNCTIONS ====================
function initTeeth() {
    const allTeeth = [
        18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
        38,37,36,35,34,33,32,31,41,42,43,44,45,46,47,48,
        55,54,53,52,51,61,62,63,64,65,
        75,74,73,72,71,81,82,83,84,85
    ];
    allTeeth.forEach(t => toothStatus[t] = 'N');
}

function createToothButton(tooth) {
    const btn = document.createElement('button');
    btn.className = 'tooth-btn normal';
    btn.innerHTML = `<span class="number">${tooth}</span><span class="status">N</span>`;
    const statuses = ['N','X','O','M','F'];
    let idx = 0;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        idx = (idx + 1) % statuses.length;
        const newStatus = statuses[idx];
        btn.className = `tooth-btn ${getStatusClass(newStatus)}`;
        btn.querySelector('.status').textContent = newStatus;
        toothStatus[tooth] = newStatus;
        updateToothFields();
    });
    return btn;
}

function getStatusClass(s) {
    return { N:'normal', X:'extract', O:'decayed', M:'missing', F:'filled' }[s] || 'normal';
}

function updateToothFields() {
    toothCategories.extraction = [];
    toothCategories.filling = [];
    Object.entries(toothStatus).forEach(([t,s]) => {
        if (s === 'X') toothCategories.extraction.push(t);
        if (s === 'F' || s === 'O') toothCategories.filling.push(t);
    });
    const extractionField = document.getElementById('toothExtraction');
    const fillingField = document.getElementById('toothFilling');
    if (extractionField) extractionField.value = toothCategories.extraction.join(', ');
    if (fillingField) fillingField.value = toothCategories.filling.join(', ');
}

function populateTeeth() {
    const quadrants = ['upperRightPerm','upperLeftPerm','lowerLeftPerm','lowerRightPerm',
                       'upperRightBaby','upperLeftBaby','lowerLeftBaby','lowerRightBaby'];
    const sets = [
        [18,17,16,15,14,13,12,11],
        [21,22,23,24,25,26,27,28],
        [38,37,36,35,34,33,32,31],
        [41,42,43,44,45,46,47,48],
        [55,54,53,52,51],
        [61,62,63,64,65],
        [75,74,73,72,71],
        [81,82,83,84,85]
    ];
    quadrants.forEach((id, i) => {
        const cont = document.getElementById(id);
        if (cont) {
            cont.innerHTML = '';
            sets[i].forEach(t => cont.appendChild(createToothButton(t)));
        }
    });
}

function resetTeeth() {
    initTeeth();
    document.querySelectorAll('.tooth-btn').forEach(btn => {
        btn.className = 'tooth-btn normal';
        btn.querySelector('.status').textContent = 'N';
    });
    updateToothFields();
}

// ==================== SEARCH FUNCTION (consolidates student + latest exam) ====================
window.searchStudent = async function() {
    console.log('=== SEARCH FUNCTION STARTED ===');
    const name = document.getElementById('searchName')?.value.trim() || '';
    const dob = document.getElementById('searchDob')?.value.trim() || '';
    const school = document.getElementById('searchSchool')?.value || '';

    if (!name || !dob || !school) {
        showStatus('searchStatus', 'Please fill all fields', 'error');
        return;
    }

    const loading = document.getElementById('searchLoading');
    const studentInfoDiv = document.getElementById('studentInfo');
    const prevRecordsDiv = document.getElementById('previousRecords');

    loading?.classList.remove('hidden');
    if (studentInfoDiv) studentInfoDiv.classList.add('hidden');
    if (prevRecordsDiv) prevRecordsDiv.classList.add('hidden');

    try {
        await openDB();

        // Try online search first if online
        if (navigator.onLine) {
            try {
                const formData = new FormData();
                formData.append('action', 'search');
                formData.append('completeName', name);
                formData.append('dob', dob);
                formData.append('school', school);

                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (result.success && result.found && result.records.length > 0) {
                    console.log('Found student online:', result.records);

                    // Sort records by timestamp descending (most recent first)
                    const sortedRecords = result.records.sort((a, b) => {
                        return new Date(b.timestamp) - new Date(a.timestamp);
                    });

                    // Get the most recent record
                    const latestRecord = sortedRecords[0];

                    // Prepare student data for local storage (using 'name' field)
                    const studentData = {
                        name: latestRecord.completeName,
                        sex: latestRecord.sex,
                        age: latestRecord.age,
                        dob: latestRecord.dob,
                        address: latestRecord.address,
                        school: latestRecord.school,
                        parentName: latestRecord.parentName,
                        contactNumber: latestRecord.contactNumber,
                        systemicConditions: latestRecord.systemicConditions,
                        allergiesFood: latestRecord.allergiesFood,
                        allergiesMedicines: latestRecord.allergiesMedicines
                    };

                    // Save student to local DB and get the saved object (with ID)
                    const savedStudent = await saveStudentToLocal(studentData);

                    // Merge with any exam data from the latest record (if present)
                    const consolidatedRecord = {
                        ...savedStudent,
                        toothExtraction: latestRecord.toothExtraction || '',
                        toothFilling: latestRecord.toothFilling || '',
                        cleaning: latestRecord.cleaning || '',
                        fluoride: latestRecord.fluoride || '',
                        dentalConsultations: latestRecord.dentalConsultations || '',
                        severeCavities: latestRecord.severeCavities || '',
                        oralExamNotes: latestRecord.oralExamNotes || '',
                        cleaningNotes: latestRecord.cleaningNotes || '',
                        remarks: latestRecord.remarks || ''
                    };

                    // Display the consolidated info
                    displayConsolidatedInfo(consolidatedRecord);

                    // Set current student to the saved student (has real ID)
                    currentStudent = savedStudent;
                    currentStudentId = savedStudent.id;

                    // Show previous visits if any (excluding the most recent)
                    if (sortedRecords.length > 1) {
                        // Convert previous records to a format that can be displayed (optional)
                        displayPreviousExams(sortedRecords.slice(1));
                    }

                    showStatus('searchStatus', `✅ Found ${sortedRecords.length} visit(s)`, 'success');
                    loading?.classList.add('hidden');
                    return;
                }
            } catch (e) {
                console.log('Online search failed, trying local:', e);
            }
        }

        // Try local search (offline or if online search failed)
        const tx = db.transaction('students', 'readonly');
        const store = tx.objectStore('students');
        const all = await new Promise(res => {
            const req = store.getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => res([]);
        });

        // Find matching student
        const student = all.find(s =>
            s.name?.toLowerCase() === name.toLowerCase() &&
            s.dob === dob &&
            s.school?.toLowerCase() === school.toLowerCase()
        );

        if (student) {
            console.log('Found student locally:', student);

            // Get their latest exam
            const examTx = db.transaction('exams', 'readonly');
            const examStore = examTx.objectStore('exams');
            const examIndex = examStore.index('studentId');
            const exams = await new Promise(res => {
                const req = examIndex.getAll(student.id);
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => res([]);
            });

            // Sort by date (most recent first)
            exams.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Consolidate student info with latest exam
            const consolidated = {
                ...student,
                ...(exams[0] || {}) // Merge with latest exam if exists
            };

            displayConsolidatedInfo(consolidated);
            currentStudent = student;
            currentStudentId = student.id;

            if (exams.length > 1) {
                displayPreviousExams(exams.slice(1));
            } else {
                document.getElementById('previousRecords')?.classList.add('hidden');
            }

            showStatus('searchStatus', `✅ Found locally with ${exams.length} exam(s)`, 'success');
        } else {
            // Student not found anywhere
            if (confirm('❌ Student not found. Create new record?')) {
                document.getElementById('editName').value = name;
                document.getElementById('editDob').value = dob;
                document.getElementById('editSchool').value = school;
                document.getElementById('studentForm')?.classList.remove('hidden');
                showStatus('searchStatus', '📝 Fill in student details', 'info');
            } else {
                showStatus('searchStatus', '❌ Not found', 'error');
            }
        }
    } catch (e) {
        console.error('Search error:', e);
        showStatus('searchStatus', '❌ Search error', 'error');
    } finally {
        loading?.classList.add('hidden');
    }
};

// Helper function to display consolidated info
function displayConsolidatedInfo(record) {
    // Display student info
    document.getElementById('displayName').textContent = record.name || record.completeName || '';
    document.getElementById('displayDob').textContent = record.dob || '';
    document.getElementById('displaySchool').textContent = record.school || '';
    document.getElementById('displayParent').textContent = record.parentName || '';
    document.getElementById('displayContact').textContent = record.contactNumber || '';
    document.getElementById('displaySystemic').textContent = record.systemicConditions || 'None';
    document.getElementById('displayFoodAllergy').textContent = record.allergiesFood || 'None';
    document.getElementById('displayMedAllergy').textContent = record.allergiesMedicines || 'None';

    // Fill edit form
    document.getElementById('editName').value = record.name || record.completeName || '';
    document.getElementById('editSex').value = record.sex || '';
    document.getElementById('editAge').value = record.age || '';
    document.getElementById('editDob').value = record.dob || '';
    document.getElementById('editAddress').value = record.address || '';
    document.getElementById('editSchool').value = record.school || '';
    document.getElementById('editParent').value = record.parentName || '';
    document.getElementById('editContact').value = record.contactNumber || '';
    document.getElementById('editSystemic').value = record.systemicConditions || '';
    document.getElementById('editFoodAllergy').value = record.allergiesFood || '';
    document.getElementById('editMedAllergy').value = record.allergiesMedicines || '';

    // Fill dental exam form with latest exam data
    document.getElementById('toothExtraction').value = record.toothExtraction || '';
    document.getElementById('toothFilling').value = record.toothFilling || '';
    document.getElementById('toothCleaning').value = record.cleaning || '';
    document.getElementById('fluoride').value = record.fluoride || '';
    document.getElementById('dentalConsult').value = record.dentalConsultations || '';
    document.getElementById('severeCavities').value = record.severeCavities || '';
    document.getElementById('oralNotes').value = record.oralExamNotes || '';
    document.getElementById('cleaningNotes').value = record.cleaningNotes || '';
    document.getElementById('remarks').value = record.remarks || '';

    // Restore tooth chart if tooth data exists
    if (record.toothData) {
        Object.assign(toothStatus, record.toothData);
        document.querySelectorAll('.tooth-btn').forEach(btn => {
            const tooth = btn.querySelector('.number')?.textContent;
            if (tooth && toothStatus[tooth]) {
                const status = toothStatus[tooth];
                btn.className = `tooth-btn ${getStatusClass(status)}`;
                btn.querySelector('.status').textContent = status;
            }
        });
        updateToothFields();
    } else {
        // Reset teeth to normal if no tooth data
        resetTeeth();
    }

    // Show the sections
    document.getElementById('studentInfo')?.classList.remove('hidden');
    document.getElementById('studentForm')?.classList.remove('hidden');
    document.getElementById('selectedStudentName').textContent = record.name || record.completeName || 'Unknown';
}

// Helper to display previous exams
function displayPreviousExams(exams) {
    const container = document.getElementById('recordsList');
    const prevDiv = document.getElementById('previousRecords');
    
    if (!container || !prevDiv || !exams.length) return;
    
    container.innerHTML = exams.map(exam => {
        // Escape the exam object for safe onclick
        const examStr = JSON.stringify(exam).replace(/'/g, "&#39;");
        return `
            <div class="record-item" onclick='loadExam(${examStr})'>
                <div class="record-date">${new Date(exam.date).toLocaleDateString()}</div>
                <div>Extraction: ${exam.toothExtraction || '—'}</div>
                <div>Filling: ${exam.toothFilling || '—'}</div>
            </div>
        `;
    }).join('');
    
    prevDiv.classList.remove('hidden');
}

// Helper to load a previous exam
window.loadExam = function(exam) {
    if (confirm('Load this previous exam? Current unsaved data will be lost.')) {
        document.getElementById('toothExtraction').value = exam.toothExtraction || '';
        document.getElementById('toothFilling').value = exam.toothFilling || '';
        document.getElementById('toothCleaning').value = exam.cleaning || '';
        document.getElementById('fluoride').value = exam.fluoride || '';
        document.getElementById('dentalConsult').value = exam.dentalConsult || '';
        document.getElementById('severeCavities').value = exam.severeCavities || '';
        document.getElementById('oralNotes').value = exam.oralNotes || '';
        document.getElementById('cleaningNotes').value = exam.cleaningNotes || '';
        document.getElementById('remarks').value = exam.remarks || '';

        if (exam.toothData) {
            Object.assign(toothStatus, exam.toothData);
            document.querySelectorAll('.tooth-btn').forEach(btn => {
                const tooth = btn.querySelector('.number')?.textContent;
                if (tooth) {
                    const status = toothStatus[tooth] || 'N';
                    btn.className = `tooth-btn ${getStatusClass(status)}`;
                    btn.querySelector('.status').textContent = status;
                }
            });
            updateToothFields();
        }
        showToast('Loaded previous exam', 'success');
    }
};

// Helper to save student to local DB and return the saved object (with ID)
async function saveStudentToLocal(record) {
    try {
        await openDB();
        const student = {
            name: record.name || record.completeName,
            sex: record.sex,
            age: record.age,
            dob: record.dob,
            address: record.address,
            school: record.school,
            parentName: record.parentName,
            contactNumber: record.contactNumber,
            systemicConditions: record.systemicConditions,
            allergiesFood: record.allergiesFood,
            allergiesMedicines: record.allergiesMedicines,
            lastUpdated: new Date().toISOString()
        };

        const tx = db.transaction('students', 'readwrite');
        const store = tx.objectStore('students');

        // Check if student already exists (by name, dob, school)
        const all = await new Promise(res => {
            const req = store.getAll();
            req.onsuccess = () => res(req.result);
        });

        const existing = all.find(s =>
            s.name === student.name &&
            s.dob === student.dob &&
            s.school === student.school
        );

        if (existing) {
            // Update existing student
            student.id = existing.id;
            await store.put(student);
            console.log('Updated existing student with ID:', student.id);
            return student;
        } else {
            // Add new student
            const id = await store.add(student);
            student.id = id;
            console.log('Added new student with ID:', id);
            return student;
        }
    } catch (e) {
        console.error('Error saving student locally:', e);
        return null;
    }
}

// ==================== DENTAL EXAM SAVE ====================
document.getElementById('dentalExamForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!currentStudentId) {
        alert('Please select a student first');
        return;
    }

    // Format date properly (DD/MM/YYYY)
    let formattedDob = currentStudent.dob;
    if (currentStudent.dob) {
        if (currentStudent.dob instanceof Date) {
            const day = String(currentStudent.dob.getDate()).padStart(2, '0');
            const month = String(currentStudent.dob.getMonth() + 1).padStart(2, '0');
            const year = currentStudent.dob.getFullYear();
            formattedDob = `${day}/${month}/${year}`;
        } else if (typeof currentStudent.dob === 'string' && currentStudent.dob.includes('GMT')) {
            const date = new Date(currentStudent.dob);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            formattedDob = `${day}/${month}/${year}`;
        } else {
            formattedDob = currentStudent.dob; // assume it's already correct
        }
    }

    // Build the record with the keys Apps Script expects
    const fullRecord = {
        completeName: currentStudent.name || '',
        sex: currentStudent.sex || '',
        age: currentStudent.age || '',
        dob: formattedDob,
        address: currentStudent.address || '',
        school: currentStudent.school || '',
        parentName: currentStudent.parentName || '',
        contactNumber: currentStudent.contactNumber || '',
        systemicConditions: currentStudent.systemicConditions || '',
        allergiesFood: currentStudent.allergiesFood || '',
        allergiesMedicines: currentStudent.allergiesMedicines || '',

        toothExtraction: document.getElementById('toothExtraction')?.value || '',
        toothFilling: document.getElementById('toothFilling')?.value || '',
        cleaning: document.getElementById('toothCleaning')?.value || '',
        fluoride: document.getElementById('fluoride')?.value || '',
        dentalConsultations: document.getElementById('dentalConsult')?.value || '',
        severeCavities: document.getElementById('severeCavities')?.value || '',
        oralExamNotes: document.getElementById('oralNotes')?.value || '',
        cleaningNotes: document.getElementById('cleaningNotes')?.value || '',
        remarks: document.getElementById('remarks')?.value || '',

        // Empty fields to match sheet columns
        hasToothbrush: '',
        brushFrequency: '',
        toothbrushChanges: '',
        usesToothpaste: '',
        dentalVisits: '',
        dentalProcedures: ''
    };

    console.log('SENDING TO APPS SCRIPT:', JSON.stringify(fullRecord, null, 2));

    try {
        const formData = new FormData();
        formData.append('action', 'save');
        formData.append('record', JSON.stringify(fullRecord));

        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: formData
        });

        const responseText = await response.text();
        console.log('RESPONSE:', responseText);

        const result = JSON.parse(responseText);
        if (result.success) {
            alert('✅ Saved to Google Sheet!');
            e.target.reset();
            resetTeeth();

            // Save exam locally for history
            await saveExamLocally(currentStudentId, fullRecord);

            // Refresh previous exams list
            loadPreviousExams(currentStudentId);
        } else {
            alert('❌ Error: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error: ' + error.message);
    }
});

// Helper to save exam locally
async function saveExamLocally(studentId, examData) {
    try {
        await openDB();
        const exam = {
            studentId: studentId,
            date: new Date().toISOString(),
            toothExtraction: examData.toothExtraction,
            toothFilling: examData.toothFilling,
            cleaning: examData.cleaning,
            fluoride: examData.fluoride,
            dentalConsult: examData.dentalConsultations,
            severeCavities: examData.severeCavities,
            oralNotes: examData.oralExamNotes,
            cleaningNotes: examData.cleaningNotes,
            remarks: examData.remarks,
            toothData: { ...toothStatus }
        };
        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');
        await store.add(exam);
    } catch (e) {
        console.error('Error saving exam locally:', e);
    }
}

// Helper to load previous exams for a student
async function loadPreviousExams(studentId) {
    try {
        await openDB();
        const tx = db.transaction('exams', 'readonly');
        const store = tx.objectStore('exams');
        const index = store.index('studentId');
        const exams = await new Promise(res => {
            const req = index.getAll(studentId);
            req.onsuccess = () => res(req.result);
        });
        exams.sort((a, b) => new Date(b.date) - new Date(a.date));
        if (exams.length > 1) {
            displayPreviousExams(exams.slice(1));
        } else {
            document.getElementById('previousRecords')?.classList.add('hidden');
        }
    } catch (e) {
        console.error('Error loading previous exams:', e);
    }
}

// ==================== UI HELPERS ====================
function switchTab(num) {
    document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===num-1));
    document.querySelectorAll('.tab-content').forEach((c,i) => c.classList.toggle('hidden', i!==num-1));
}

function showStatus(id, msg, type) {
    const el = document.getElementById(id);
    if (el) {
        el.className = `status ${type}`;
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
}

function showToast(msg, type='info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast';
    toast.style.background = { success:'#28a745', error:'#dc3545', offline:'#ffc107', syncing:'#17a2b8' }[type] || '#333';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function updateOnlineStatus() {
    const statusDiv = document.getElementById('connectionStatus');
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    if (navigator.onLine) {
        if (statusDiv) statusDiv.className = 'status online';
        if (icon) icon.textContent = '✅';
        if (text) text.textContent = 'You are online / Online ka';
        syncWithGoogleSheets();
    } else {
        if (statusDiv) statusDiv.className = 'status offline';
        if (icon) icon.textContent = '📴';
        if (text) text.textContent = 'You are offline / Offline ka';
    }
}

window.clearSearch = function() {
    document.getElementById('searchName').value = '';
    document.getElementById('searchDob').value = '';
    document.getElementById('searchSchool').value = '';
    document.getElementById('studentInfo')?.classList.add('hidden');
    document.getElementById('previousRecords')?.classList.add('hidden');
    document.getElementById('studentForm')?.classList.add('hidden');
    resetTeeth();
    document.getElementById('dentalExamForm')?.reset();
    showToast('Cleared', 'info');
};

window.syncPendingRecords = syncWithGoogleSheets;

// ==================== INIT ====================
window.addEventListener('load', async () => {
    await openDB();
    initTeeth();
    populateTeeth();
    updateOnlineStatus();
    await updatePendingCount();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(e => console.log('SW error', e));
    }
});