// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvPwxiSee3iDYQP49VwNA58uz85GcI4xIdcOaNoko8s9M9mMBTK8SvyDC3744HfPpvdg/exec';
const DB_NAME = 'DentalOfflineDB';
const DB_VERSION = 10; // increment to upgrade schema

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

            // Students store
            const studentStore = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
            studentStore.createIndex('name', 'name', { unique: false });
            studentStore.createIndex('dob', 'dob', { unique: false });
            studentStore.createIndex('school', 'school', { unique: false });

            // Exams store with synced flag
            const examStore = db.createObjectStore('exams', { keyPath: 'id', autoIncrement: true });
            examStore.createIndex('studentId', 'studentId', { unique: false });
            examStore.createIndex('date', 'date', { unique: false });
            examStore.createIndex('synced', 'synced', { unique: false });

            console.log('Database stores created');
        };
    });
    return dbInitPromise;
}

// ==================== DATE FORMATTING ====================
function formatDateForDisplay(dateValue) {
    if (!dateValue) return '';
    if (dateValue instanceof Date) {
        const day = String(dateValue.getDate()).padStart(2, '0');
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const year = dateValue.getFullYear();
        return `${day}/${month}/${year}`;
    }
    if (typeof dateValue === 'string') {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateValue)) return dateValue;
        const d = new Date(dateValue);
        if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        }
    }
    return String(dateValue);
}

// ==================== SYNC UNSYNCED EXAMS (FIXED) ====================
async function syncUnsyncedExams() {
    if (!navigator.onLine) {
        console.log('Offline, cannot sync');
        return;
    }
    await openDB();
    const tx = db.transaction('exams', 'readonly');
    const store = tx.objectStore('exams');
    const request = store.getAll(); // get all exams, we'll filter in memory

    return new Promise(resolve => {
        request.onsuccess = async () => {
            const allExams = request.result;
            const unsynced = allExams.filter(exam => !exam.synced);
            if (unsynced.length === 0) {
                console.log('No unsynced exams');
                resolve();
                return;
            }
            console.log(`Syncing ${unsynced.length} unsynced exams...`);
            let successCount = 0;
            for (const exam of unsynced) {
                try {
                    const formData = new FormData();
                    formData.append('action', 'save');
                    formData.append('record', JSON.stringify(exam.data));

                    const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: formData });
                    if (response.ok) {
                        // Mark as synced
                        const updateTx = db.transaction('exams', 'readwrite');
                        const updateStore = updateTx.objectStore('exams');
                        exam.synced = true;
                        await updateStore.put(exam);
                        successCount++;
                    } else {
                        console.error('Sync failed for exam', exam.id, await response.text());
                    }
                } catch (e) {
                    console.error('Sync error for exam', exam.id, e);
                }
            }
            showToast(`✅ Synced ${successCount} of ${unsynced.length} exams`, successCount ? 'success' : 'error');
            resolve();
        };
        request.onerror = () => resolve();
    });
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

// ==================== SEARCH FUNCTION (with online cache and offline fix) ====================
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

                const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: formData });
                const result = await response.json();

                if (result.success && result.found && result.records.length > 0) {
                    console.log('Found student online, caching records...');

                    const sortedRecords = result.records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    const latestRecord = sortedRecords[0];

                    // Format date for local storage
                    const formattedDob = formatDateForDisplay(latestRecord.dob);

                    const studentData = {
                        name: latestRecord.completeName,
                        sex: latestRecord.sex,
                        age: latestRecord.age,
                        dob: formattedDob,
                        address: latestRecord.address,
                        school: latestRecord.school,
                        parentName: latestRecord.parentName,
                        contactNumber: latestRecord.contactNumber,
                        systemicConditions: latestRecord.systemicConditions,
                        allergiesFood: latestRecord.allergiesFood,
                        allergiesMedicines: latestRecord.allergiesMedicines
                    };

                    const savedStudent = await saveStudentToLocal(studentData);
                    currentStudent = savedStudent;
                    currentStudentId = savedStudent.id;

                    // Cache exams
                    const examTx = db.transaction('exams', 'readwrite');
                    const examStore = examTx.objectStore('exams');
                    for (const record of sortedRecords) {
                        const existing = await findExamByDate(currentStudentId, record.timestamp);
                        if (!existing) {
                            const examData = { ...record, dob: formatDateForDisplay(record.dob) };
                            const exam = {
                                studentId: currentStudentId,
                                date: record.timestamp,
                                data: examData,
                                synced: true
                            };
                            await examStore.add(exam);
                        }
                    }

                    const allExams = await getExamsForStudent(currentStudentId);
                    const latestExam = allExams.length > 0 ? { ...savedStudent, ...allExams[0].data } : savedStudent;
                    displayConsolidatedInfo(latestExam);
                    if (allExams.length > 1) {
                        displayPreviousExams(allExams.slice(1));
                    }

                    showStatus('searchStatus', `✅ Found ${sortedRecords.length} visit(s)`, 'success');
                    loading?.classList.add('hidden');
                    return;
                }
            } catch (e) {
                console.log('Online search failed, trying local:', e);
            }
        }

        // Offline search
        const tx = db.transaction('students', 'readonly');
        const store = tx.objectStore('students');
        const all = await new Promise(res => {
            const req = store.getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => res([]);
        });

        const student = all.find(s =>
            s.name?.toLowerCase() === name.toLowerCase() &&
            s.dob === dob &&
            s.school?.toLowerCase() === school.toLowerCase()
        );

        if (student) {
            console.log('Found student locally:', student);
            const exams = await getExamsForStudent(student.id);
            currentStudent = student;
            currentStudentId = student.id;
            const latestExam = exams.length > 0 ? { ...student, ...exams[0].data } : student;
            displayConsolidatedInfo(latestExam);
            if (exams.length > 1) {
                displayPreviousExams(exams.slice(1));
            }
            showStatus('searchStatus', `✅ Found locally with ${exams.length} exam(s)`, 'success');
        } else {
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

// ==================== HELPER FUNCTIONS FOR EXAMS ====================
async function findExamByDate(studentId, date) {
    await openDB();
    const tx = db.transaction('exams', 'readonly');
    const store = tx.objectStore('exams');
    const index = store.index('studentId');
    const exams = await new Promise(res => {
        const req = index.getAll(studentId);
        req.onsuccess = () => res(req.result);
    });
    return exams.find(e => e.date === date);
}

async function getExamsForStudent(studentId) {
    await openDB();
    const tx = db.transaction('exams', 'readonly');
    const store = tx.objectStore('exams');
    const index = store.index('studentId');
    const exams = await new Promise(res => {
        const req = index.getAll(studentId);
        req.onsuccess = () => res(req.result || []);
    });
    return exams.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ==================== DISPLAY FUNCTIONS ====================
function displayConsolidatedInfo(record) {
    const formattedDob = formatDateForDisplay(record.dob);

    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '';
    };
    const setValue = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    setText('displayName', record.name || record.completeName);
    setText('displayDob', formattedDob);
    setText('displaySchool', record.school);
    setText('displayParent', record.parentName);
    setText('displayContact', record.contactNumber);
    setText('displaySystemic', record.systemicConditions || 'None');
    setText('displayFoodAllergy', record.allergiesFood || 'None');
    setText('displayMedAllergy', record.allergiesMedicines || 'None');

    setValue('editName', record.name || record.completeName);
    setValue('editSex', record.sex);
    setValue('editAge', record.age);
    setValue('editDob', formattedDob);
    setValue('editAddress', record.address);
    setValue('editSchool', record.school);
    setValue('editParent', record.parentName);
    setValue('editContact', record.contactNumber);
    setValue('editSystemic', record.systemicConditions);
    setValue('editFoodAllergy', record.allergiesFood);
    setValue('editMedAllergy', record.allergiesMedicines);

    setValue('toothExtraction', record.toothExtraction);
    setValue('toothFilling', record.toothFilling);
    setValue('toothCleaning', record.cleaning);
    setValue('fluoride', record.fluoride);
    setValue('dentalConsult', record.dentalConsultations);
    setValue('severeCavities', record.severeCavities);
    setValue('oralNotes', record.oralExamNotes);
    setValue('cleaningNotes', record.cleaningNotes);
    setValue('remarks', record.remarks);

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
        resetTeeth();
    }

    const studentInfo = document.getElementById('studentInfo');
    const studentForm = document.getElementById('studentForm');
    const selectedName = document.getElementById('selectedStudentName');
    if (studentInfo) studentInfo.classList.remove('hidden');
    if (studentForm) studentForm.classList.remove('hidden');
    if (selectedName) selectedName.textContent = record.name || record.completeName || 'Unknown';
}

function displayPreviousExams(exams) {
    const container = document.getElementById('recordsList');
    const prevDiv = document.getElementById('previousRecords');
    if (!container || !prevDiv || !exams.length) return;

    container.innerHTML = exams.map(exam => {
        const examStr = JSON.stringify(exam.data || exam).replace(/'/g, "&#39;");
        return `
            <div class="record-item" onclick='loadExam(${examStr})'>
                <div class="record-date">${new Date(exam.date).toLocaleDateString()}</div>
                <div>Extraction: ${(exam.data || exam).toothExtraction || '—'}</div>
                <div>Filling: ${(exam.data || exam).toothFilling || '—'}</div>
            </div>
        `;
    }).join('');
    prevDiv.classList.remove('hidden');
}

window.loadExam = function(examData) {
    if (confirm('Load this previous exam? Current unsaved data will be lost.')) {
        document.getElementById('toothExtraction').value = examData.toothExtraction || '';
        document.getElementById('toothFilling').value = examData.toothFilling || '';
        document.getElementById('toothCleaning').value = examData.cleaning || '';
        document.getElementById('fluoride').value = examData.fluoride || '';
        document.getElementById('dentalConsult').value = examData.dentalConsultations || '';
        document.getElementById('severeCavities').value = examData.severeCavities || '';
        document.getElementById('oralNotes').value = examData.oralExamNotes || '';
        document.getElementById('cleaningNotes').value = examData.cleaningNotes || '';
        document.getElementById('remarks').value = examData.remarks || '';

        if (examData.toothData) {
            Object.assign(toothStatus, examData.toothData);
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

// ==================== SAVE STUDENT LOCALLY ====================
async function saveStudentToLocal(studentData) {
    await openDB();
    const tx = db.transaction('students', 'readwrite');
    const store = tx.objectStore('students');

    const all = await new Promise(res => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
    });
    const existing = all.find(s =>
        s.name === studentData.name &&
        s.dob === studentData.dob &&
        s.school === studentData.school
    );

    if (existing) {
        studentData.id = existing.id;
        await store.put(studentData);
        return studentData;
    } else {
        const id = await store.add(studentData);
        studentData.id = id;
        return studentData;
    }
}

// ==================== SAVE DENTAL EXAM ====================
document.getElementById('dentalExamForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!currentStudentId) {
        alert('Please select a student first');
        return;
    }

    const formattedDob = formatDateForDisplay(currentStudent.dob);

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
        extractionNotes: document.getElementById('extractionNotes')?.value || '',
        fillingNotes: document.getElementById('fillingNotes')?.value || '',

        hasToothbrush: '',
        brushFrequency: '',
        toothbrushChanges: '',
        usesToothpaste: '',
        dentalVisits: '',
        dentalProcedures: ''
    };

    try {
        await openDB();

        const exam = {
            studentId: currentStudentId,
            date: new Date().toISOString(),
            data: fullRecord,
            synced: false
        };

        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');
        const examId = await store.add(exam);
        console.log('Exam saved locally with ID', examId);

        if (navigator.onLine) {
            const formData = new FormData();
            formData.append('action', 'save');
            formData.append('record', JSON.stringify(fullRecord));

            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: formData });
            if (response.ok) {
                exam.synced = true;
                exam.id = examId;
                await store.put(exam);
                showToast('✅ Saved to Google Sheet and synced!', 'success');
            } else {
                showToast('📱 Saved locally (will sync later)', 'offline');
            }
        } else {
            showToast('📱 Saved offline (will sync when online)', 'offline');
        }

        e.target.reset();
        resetTeeth();

        const exams = await getExamsForStudent(currentStudentId);
        if (exams.length > 1) {
            displayPreviousExams(exams.slice(1));
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('❌ Save failed', 'error');
    }
});

// ==================== NEW STUDENT ====================
window.newStudent = function() {
    ['editName','editSex','editAge','editDob','editAddress','editSchool',
     'editParent','editContact','editSystemic','editFoodAllergy','editMedAllergy']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    document.getElementById('studentForm')?.classList.remove('hidden');
    document.getElementById('studentInfo')?.classList.add('hidden');
    document.getElementById('selectedStudentName').textContent = 'New Student';
    currentStudent = null;
    currentStudentId = null;
    resetTeeth();
};

// ==================== SAVE STUDENT INFO ====================
window.saveStudentInfo = async function() {
    const student = {
        name: document.getElementById('editName')?.value || '',
        sex: document.getElementById('editSex')?.value || '',
        age: document.getElementById('editAge')?.value || '',
        dob: document.getElementById('editDob')?.value || '',
        address: document.getElementById('editAddress')?.value || '',
        school: document.getElementById('editSchool')?.value || '',
        parentName: document.getElementById('editParent')?.value || '',
        contactNumber: document.getElementById('editContact')?.value || '',
        systemicConditions: document.getElementById('editSystemic')?.value || '',
        allergiesFood: document.getElementById('editFoodAllergy')?.value || '',
        allergiesMedicines: document.getElementById('editMedAllergy')?.value || '',
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
    displayConsolidatedInfo(student);
    showToast('✅ Student saved', 'success');
};

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
        syncUnsyncedExams(); // auto-sync when online
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

window.syncPendingRecords = syncUnsyncedExams;

// ==================== INIT ====================
window.addEventListener('load', async () => {
    await openDB();
    initTeeth();
    populateTeeth();
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(e => console.log('SW error', e));
    }
});
