// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvPwxiSee3iDYQP49VwNA58uz85GcI4xIdcOaNoko8s9M9mMBTK8SvyDC3744HfPpvdg/exec';
const DB_NAME = 'DentalOfflineDB';
const DB_VERSION = 7; // increment to rebuild stores

// ==================== GLOBAL VARIABLES ====================
let db = null;
let currentStudent = null;          // full student object including id
let currentStudentId = null;
let dbInitPromise = null;
const toothStatus = {};              // tooth number -> status (N,X,O,M,F)
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
            // clean slate
            Array.from(db.objectStoreNames).forEach(name => db.deleteObjectStore(name));

            // students store
            const studentStore = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
            studentStore.createIndex('name', 'name', { unique: false });
            studentStore.createIndex('dob', 'dob', { unique: false });
            studentStore.createIndex('school', 'school', { unique: false });

            // exams store (dental records)
            const examStore = db.createObjectStore('exams', { keyPath: 'id', autoIncrement: true });
            examStore.createIndex('studentId', 'studentId', { unique: false });
            examStore.createIndex('date', 'date', { unique: false });

            // pending sync store
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

// ==================== SYNC WITH APPS SCRIPT ====================
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
            } else fail++;
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
    document.getElementById('toothExtraction').value = toothCategories.extraction.join(', ');
    document.getElementById('toothFilling').value = toothCategories.filling.join(', ');
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

// ==================== STUDENT SEARCH (IndexedDB) ====================
window.searchStudent = async function() {
    const name = document.getElementById('searchName').value.trim();
    const dob = document.getElementById('searchDob').value.trim();
    const school = document.getElementById('searchSchool').value;
    if (!name || !dob || !school) {
        showStatus('searchStatus', 'Please fill all fields', 'error');
        return;
    }
    const loading = document.getElementById('searchLoading');
    const studentInfoDiv = document.getElementById('studentInfo');
    const prevRecordsDiv = document.getElementById('previousRecords');
    loading.classList.remove('hidden');
    studentInfoDiv.classList.add('hidden');
    prevRecordsDiv.classList.add('hidden');

    try {
        await openDB();
        const tx = db.transaction('students', 'readonly');
        const store = tx.objectStore('students');
        const all = await new Promise(res => {
            const req = store.getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => res([]);
        });

        const matches = all.filter(s =>
            s.name?.toLowerCase() === name.toLowerCase() &&
            s.dob === dob &&
            s.school?.toLowerCase() === school.toLowerCase()
        );

        if (matches.length) {
            // take the most recent (by highest id) as current
            const student = matches.sort((a,b) => b.id - a.id)[0];
            currentStudent = student;
            currentStudentId = student.id;
            displayStudentInfo(student);
            loadPreviousExams(student.id);
            showStatus('searchStatus', `✅ Found ${matches.length} record(s)`, 'success');
        } else {
            // not found – ask to create new
            if (confirm('❌ Student not found. Create new?')) {
                document.getElementById('editName').value = name;
                document.getElementById('editDob').value = dob;
                document.getElementById('editSchool').value = school;
                document.getElementById('studentForm').classList.remove('hidden');
                showStatus('searchStatus', '📝 Fill in student details', 'info');
            } else {
                showStatus('searchStatus', '❌ Not found', 'error');
            }
        }
    } catch (e) {
        console.error(e);
        showStatus('searchStatus', '❌ Search error', 'error');
    } finally {
        loading.classList.add('hidden');
    }
};

function displayStudentInfo(s) {
    document.getElementById('displayName').textContent = s.name || '';
    document.getElementById('displayDob').textContent = s.dob || '';
    document.getElementById('displaySchool').textContent = s.school || '';
    document.getElementById('displayParent').textContent = s.parentName || '';
    document.getElementById('displayContact').textContent = s.contactNumber || '';
    document.getElementById('displaySystemic').textContent = s.systemicConditions || 'None';
    document.getElementById('displayFoodAllergy').textContent = s.allergiesFood || 'None';
    document.getElementById('displayMedAllergy').textContent = s.allergiesMedicines || 'None';

    // also fill edit form
    document.getElementById('editName').value = s.name || '';
    document.getElementById('editSex').value = s.sex || '';
    document.getElementById('editAge').value = s.age || '';
    document.getElementById('editDob').value = s.dob || '';
    document.getElementById('editAddress').value = s.address || '';
    document.getElementById('editSchool').value = s.school || '';
    document.getElementById('editParent').value = s.parentName || '';
    document.getElementById('editContact').value = s.contactNumber || '';
    document.getElementById('editSystemic').value = s.systemicConditions || '';
    document.getElementById('editFoodAllergy').value = s.allergiesFood || '';
    document.getElementById('editMedAllergy').value = s.allergiesMedicines || '';

    document.getElementById('studentInfo').classList.remove('hidden');
    document.getElementById('studentForm').classList.remove('hidden');
    document.getElementById('selectedStudentName').textContent = s.name || 'None';
}

window.newStudent = function() {
    // clear edit form
    document.getElementById('editName').value = '';
    document.getElementById('editSex').value = '';
    document.getElementById('editAge').value = '';
    document.getElementById('editDob').value = '';
    document.getElementById('editAddress').value = '';
    document.getElementById('editSchool').value = '';
    document.getElementById('editParent').value = '';
    document.getElementById('editContact').value = '';
    document.getElementById('editSystemic').value = '';
    document.getElementById('editFoodAllergy').value = '';
    document.getElementById('editMedAllergy').value = '';
    document.getElementById('studentForm').classList.remove('hidden');
    document.getElementById('studentInfo').classList.add('hidden');
    document.getElementById('selectedStudentName').textContent = 'New Student';
    currentStudent = null;
    currentStudentId = null;
};

window.saveStudentInfo = async function() {
    const student = {
        name: document.getElementById('editName').value,
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
        lastUpdated: new Date().toISOString()
    };
    if (!student.name || !student.dob || !student.school) {
        showToast('Please fill required fields', 'error');
        return;
    }
    await openDB();
    const tx = db.transaction('students', 'readwrite');
    const store = tx.objectStore('students');
    if (currentStudentId) {
        student.id = currentStudentId;
        await store.put(student);
        currentStudent = student;
    } else {
        const id = await store.add(student);
        student.id = id;
        currentStudent = student;
        currentStudentId = id;
    }
    displayStudentInfo(student);
    showToast('✅ Student saved', 'success');
    // optionally sync to cloud (pending)
    if (navigator.onLine) {
        // you could also send immediately
        savePending({ type: 'student', data: student }).then(() => syncWithGoogleSheets());
    } else {
        savePending({ type: 'student', data: student });
    }
};

async function loadPreviousExams(studentId) {
    await openDB();
    const tx = db.transaction('exams', 'readonly');
    const store = tx.objectStore('exams');
    const index = store.index('studentId');
    const req = index.getAll(studentId);
    req.onsuccess = () => {
        const exams = req.result.sort((a,b) => new Date(b.date) - new Date(a.date));
        const container = document.getElementById('recordsList');
        const prevDiv = document.getElementById('previousRecords');
        if (exams.length) {
            container.innerHTML = exams.map(e => `
                <div class="record-item" onclick='loadExam(${JSON.stringify(e)})'>
                    <div class="record-date">${new Date(e.date).toLocaleDateString()}</div>
                    <div>Extraction: ${e.toothExtraction || '—'}</div>
                    <div>Filling: ${e.toothFilling || '—'}</div>
                </div>
            `).join('');
            prevDiv.classList.remove('hidden');
        } else {
            prevDiv.classList.add('hidden');
        }
    };
}

window.loadExam = function(exam) {
    if (confirm('Load this previous exam? Current unsaved data will be lost.')) {
        document.getElementById('toothExtraction').value = exam.toothExtraction || '';
        document.getElementById('toothFilling').value = exam.toothFilling || '';
        document.getElementById('toothCleaning').value = exam.toothCleaning || '';
        document.getElementById('fluoride').value = exam.fluoride || '';
        document.getElementById('dentalConsult').value = exam.dentalConsult || '';
        document.getElementById('severeCavities').value = exam.severeCavities || '';
        document.getElementById('oralNotes').value = exam.oralNotes || '';
        document.getElementById('cleaningNotes').value = exam.cleaningNotes || '';
        document.getElementById('extractionNotes').value = exam.extractionNotes || '';
        document.getElementById('fillingNotes').value = exam.fillingNotes || '';
        document.getElementById('remarks').value = exam.remarks || '';
        // restore tooth chart if toothData present
        if (exam.toothData) {
            Object.assign(toothStatus, exam.toothData);
            document.querySelectorAll('.tooth-btn').forEach(btn => {
                const tooth = btn.querySelector('.number').textContent;
                const status = toothStatus[tooth] || 'N';
                btn.className = `tooth-btn ${getStatusClass(status)}`;
                btn.querySelector('.status').textContent = status;
            });
            updateToothFields();
        }
        showToast('Loaded previous exam', 'success');
    }
};

// ==================== DENTAL EXAM SAVE ====================
document.getElementById('dentalExamForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!currentStudentId) {
        showToast('Please select a student first', 'error');
        return;
    }
    const exam = {
        studentId: currentStudentId,
        studentName: currentStudent?.name,
        date: new Date().toISOString(),
        toothExtraction: document.getElementById('toothExtraction').value,
        toothFilling: document.getElementById('toothFilling').value,
        toothCleaning: document.getElementById('toothCleaning').value,
        fluoride: document.getElementById('fluoride').value,
        dentalConsult: document.getElementById('dentalConsult').value,
        severeCavities: document.getElementById('severeCavities').value,
        oralNotes: document.getElementById('oralNotes').value,
        cleaningNotes: document.getElementById('cleaningNotes').value,
        extractionNotes: document.getElementById('extractionNotes').value,
        fillingNotes: document.getElementById('fillingNotes').value,
        remarks: document.getElementById('remarks').value,
        toothData: { ...toothStatus }
    };

    await openDB();
    const tx = db.transaction('exams', 'readwrite');
    const store = tx.objectStore('exams');
    const req = store.add(exam);
    req.onsuccess = () => {
        showToast('✅ Dental record saved locally', 'success');
        e.target.reset();
        resetTeeth();
        loadPreviousExams(currentStudentId);
        // save to pending for cloud sync
        savePending({ type: 'exam', data: exam });
        if (navigator.onLine) syncWithGoogleSheets();
    };
    req.onerror = () => showToast('❌ Save failed', 'error');
});

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
        statusDiv.className = 'status online';
        icon.textContent = '✅';
        text.textContent = 'You are online / Online ka';
        syncWithGoogleSheets();
    } else {
        statusDiv.className = 'status offline';
        icon.textContent = '📴';
        text.textContent = 'You are offline / Offline ka';
    }
}

window.clearSearch = function() {
    document.getElementById('searchName').value = '';
    document.getElementById('searchDob').value = '';
    document.getElementById('searchSchool').value = '';
    document.getElementById('studentInfo').classList.add('hidden');
    document.getElementById('previousRecords').classList.add('hidden');
    document.getElementById('studentForm').classList.add('hidden');
    resetTeeth();
    document.getElementById('dentalExamForm').reset();
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