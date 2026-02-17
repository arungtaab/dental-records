// ==================== CONFIGURATION ====================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvPwxiSee3iDYQP49VwNA58uz85GcI4xIdcOaNoko8s9M9mMBTK8SvyDC3744HfPpvdg/exec'; // Replace with your Apps Script URL
// ==================== CONFIGURATION ====================
const DB_NAME = 'DentalRecordsDB';
const DB_VERSION = 1;

// ==================== GLOBAL VARIABLES ====================
let db = null;
let currentStudent = null;
let allStudents = [];
const toothStatus = {};

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
            
            // Students store
            if (!db.objectStoreNames.contains('students')) {
                const studentStore = db.createObjectStore('students', { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                studentStore.createIndex('name', 'name', { unique: false });
                studentStore.createIndex('school', 'school', { unique: false });
                studentStore.createIndex('dob', 'dob', { unique: false });
            }
            
            // Dental records store
            if (!db.objectStoreNames.contains('dentalRecords')) {
                const recordsStore = db.createObjectStore('dentalRecords', { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                recordsStore.createIndex('studentId', 'studentId', { unique: false });
                recordsStore.createIndex('date', 'date', { unique: false });
            }
        };
    });
}

// ==================== STUDENT FUNCTIONS ====================
async function saveStudent(student) {
    await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('students', 'readwrite');
        const store = transaction.objectStore('students');
        
        if (!student.id) {
            // New student
            const request = store.add(student);
            request.onsuccess = () => resolve({ ...student, id: request.result });
            request.onerror = () => reject(request.error);
        } else {
            // Update existing
            const request = store.put(student);
            request.onsuccess = () => resolve(student);
            request.onerror = () => reject(request.error);
        }
    });
}

async function searchStudents(name, dob, school) {
    await openDB();
    
    return new Promise((resolve) => {
        const transaction = db.transaction('students', 'readonly');
        const store = transaction.objectStore('students');
        const request = store.getAll();
        
        request.onsuccess = () => {
            const students = request.result.filter(s => {
                const nameMatch = !name || (s.name && s.name.toLowerCase().includes(name.toLowerCase()));
                const dobMatch = !dob || s.dob === dob;
                const schoolMatch = !school || s.school === school;
                return nameMatch && dobMatch && schoolMatch;
            });
            resolve(students);
        };
        
        request.onerror = () => resolve([]);
    });
}

async function getAllStudents() {
    await openDB();
    
    return new Promise((resolve) => {
        const transaction = db.transaction('students', 'readonly');
        const store = transaction.objectStore('students');
        const request = store.getAll();
        
        request.onsuccess = () => {
            allStudents = request.result;
            resolve(allStudents);
        };
        
        request.onerror = () => resolve([]);
    });
}

// ==================== DENTAL RECORDS FUNCTIONS ====================
async function saveDentalRecord(record) {
    await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('dentalRecords', 'readwrite');
        const store = transaction.objectStore('dentalRecords');
        
        const recordToSave = {
            ...record,
            date: new Date().toISOString(),
            studentId: currentStudent.id
        };
        
        const request = store.add(recordToSave);
        
        request.onsuccess = () => {
            showToast('✅ Dental record saved!', 'success');
            resolve({ success: true });
        };
        
        request.onerror = () => reject(request.error);
    });
}

async function getStudentRecords(studentId) {
    await openDB();
    
    return new Promise((resolve) => {
        const transaction = db.transaction('dentalRecords', 'readonly');
        const store = transaction.objectStore('dentalRecords');
        const index = store.index('studentId');
        const request = index.getAll(studentId);
        
        request.onsuccess = () => {
            resolve(request.result.sort((a, b) => new Date(b.date) - new Date(a.date)));
        };
        
        request.onerror = () => resolve([]);
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
        updateToothFields();
    });
    
    return btn;
}

function getStatusClass(status) {
    const classes = {
        'N': 'normal', 'X': 'extract', 'O': 'decayed',
        'M': 'missing', 'F': 'filled'
    };
    return classes[status] || 'normal';
}

function updateToothFields() {
    const extraction = [];
    const filling = [];
    
    Object.entries(toothStatus).forEach(([tooth, status]) => {
        if (status === 'X') extraction.push(tooth);
        if (status === 'F' || status === 'O') filling.push(tooth);
    });
    
    document.getElementById('toothExtraction').value = extraction.join(', ');
    document.getElementById('toothFilling').value = filling.join(', ');
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
    updateToothFields();
}

// ==================== UI FUNCTIONS ====================
function switchTab(tabNumber) {
    document.querySelectorAll('.tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === tabNumber - 1);
    });
    document.querySelectorAll('.tab-content').forEach((content, i) => {
        content.classList.toggle('hidden', i !== tabNumber - 1);
    });
    
    if (tabNumber === 3) loadStudentsList();
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    toast.style.background = type === 'success' ? '#28a745' : 
                            type === 'error' ? '#dc3545' : '#333';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (el) {
        el.className = `status ${type}`;
        el.textContent = message;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }
}

function updateOnlineStatus() {
    const statusDiv = document.getElementById('connectionStatus');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    
    if (navigator.onLine) {
        statusDiv.className = 'status online';
        statusIcon.textContent = '✅';
        statusText.textContent = 'You are online / Online ka';
    } else {
        statusDiv.className = 'status offline';
        statusIcon.textContent = '📴';
        statusText.textContent = 'You are offline / Offline ka';
    }
}

// ==================== SEARCH FUNCTIONS ====================
window.searchStudent = async function() {
    const name = document.getElementById('searchName').value.trim();
    const dob = document.getElementById('searchDob').value.trim();
    const school = document.getElementById('searchSchool').value;
    
    if (!name || !dob || !school) {
        showStatus('searchStatus', 'Please fill all fields', 'error');
        return;
    }
    
    document.getElementById('searchLoading').classList.remove('hidden');
    
    const students = await searchStudents(name, dob, school);
    
    document.getElementById('searchLoading').classList.add('hidden');
    
    if (students.length > 0) {
        currentStudent = students[0];
        loadStudentToForm(currentStudent);
        document.getElementById('studentForm').classList.remove('hidden');
        showStatus('searchStatus', '✅ Student found!', 'success');
        switchTab(2);
    } else {
        if (confirm('Student not found. Create new record?')) {
            newStudent();
        }
    }
};

window.newStudent = function() {
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
    
    currentStudent = null;
    document.getElementById('studentForm').classList.remove('hidden');
    showToast('Enter new student information', 'info');
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
        allergiesMedicines: document.getElementById('editMedAllergy').value
    };
    
    if (!student.name || !student.dob || !student.school) {
        showToast('Please fill required fields', 'error');
        return;
    }
    
    if (currentStudent) {
        student.id = currentStudent.id;
    }
    
    const saved = await saveStudent(student);
    currentStudent = saved;
    
    document.getElementById('selectedStudentName').textContent = saved.name;
    showToast('Student information saved!', 'success');
    switchTab(2);
};

function loadStudentToForm(student) {
    document.getElementById('editName').value = student.name || '';
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
    
    document.getElementById('selectedStudentName').textContent = student.name;
}

// ==================== DENTAL EXAM FUNCTIONS ====================
document.getElementById('dentalExamForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!currentStudent) {
        showToast('Please select a student first', 'error');
        switchTab(1);
        return;
    }
    
    const record = {
        studentId: currentStudent.id,
        studentName: currentStudent.name,
        toothExtraction: document.getElementById('toothExtraction').value,
        toothFilling: document.getElementById('toothFilling').value,
        toothCleaning: document.getElementById('toothCleaning').value,
        fluoride: document.getElementById('fluoride').value,
        dentalConsult: document.getElementById('dentalConsult').value,
        severeCavities: document.getElementById('severeCavities').value,
        oralNotes: document.getElementById('oralNotes').value,
        cleaningNotes: document.getElementById('cleaningNotes').value,
        remarks: document.getElementById('remarks').value,
        toothData: { ...toothStatus }
    };
    
    await saveDentalRecord(record);
    e.target.reset();
    resetTeeth();
});

// ==================== RECORDS FUNCTIONS ====================
async function loadStudentsList() {
    const students = await getAllStudents();
    const list = document.getElementById('studentsList');
    
    list.innerHTML = '<h4>All Students:</h4>';
    students.forEach(s => {
        const div = document.createElement('div');
        div.className = 'record-item';
        div.innerHTML = `<strong>${s.name}</strong><br>${s.school} | ${s.dob}`;
        div.onclick = () => showStudentRecords(s.id);
        list.appendChild(div);
    });
}

async function showStudentRecords(studentId) {
    const records = await getStudentRecords(studentId);
    const list = document.getElementById('studentRecords');
    
    if (records.length === 0) {
        list.innerHTML = '<p>No dental records found</p>';
        return;
    }
    
    list.innerHTML = '<h4>Dental Records:</h4>';
    records.forEach(r => {
        const div = document.createElement('div');
        div.className = 'record-item';
        div.innerHTML = `
            <div class="record-date">${new Date(r.date).toLocaleDateString()}</div>
            <div>Extraction: ${r.toothExtraction || 'None'}</div>
            <div>Filling: ${r.toothFilling || 'None'}</div>
            <div>Notes: ${r.oralNotes || 'No notes'}</div>
        `;
        list.appendChild(div);
    });
}

// ==================== INITIALIZATION ====================
window.onload = async function() {
    await openDB();
    initTeeth();
    populateTeeth();
    updateOnlineStatus();
    await getAllStudents();
    
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
};
