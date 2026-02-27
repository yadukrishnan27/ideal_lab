import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    increment
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
    projectId: "labideal-610e0",
    appId: "1:1009062006110:web:423aab974854f63b83d3cf",
    storageBucket: "labideal-610e0.firebasestorage.app",
    apiKey: "AIzaSyBEHG2Js9ma8HqEoi2r2howTJmH3xwT4EA",
    authDomain: "labideal-610e0.firebaseapp.com",
    messagingSenderId: "1009062006110",
    measurementId: "G-BXLFSX1M55"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// IMPORTANT: Define the emails that act as Admins
const ADMIN_EMAILS = [
    'yadu.krishnan.s1513@gmail.com',  // Your email
    'admin2@idealab.local'               // Placeholder Second Admin
];

// DOM Elements
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const googleLoginBtn = document.getElementById('google-login-btn');
const authError = document.getElementById('auth-error');
const welcomeMsg = document.getElementById('welcome-msg');
const logoutBtn = document.getElementById('logout-btn');

const adminTools = document.getElementById('admin-tools');
const inventoryList = document.getElementById('inventory-list');
const requestsList = document.getElementById('requests-list');
const requestsTitle = document.getElementById('requests-title');
const addComponentForm = document.getElementById('add-component-form');

// Modals
const requestModal = document.getElementById('request-modal');
const requestPartForm = document.getElementById('request-part-form');
const closeBtn = document.querySelector('.close-btn');

const editModal = document.getElementById('edit-modal');
const editPartForm = document.getElementById('edit-part-form');
const closeEditBtn = document.querySelector('.close-edit-btn');

const profileBtn = document.getElementById('profile-btn');
const profileModal = document.getElementById('profile-modal');
const profileForm = document.getElementById('profile-form');
const closeProfileBtn = document.querySelector('.close-profile-btn');

// State
let currentUser = null;
let role = 'student';
let userName = '';
let userCollegeId = ''; // Used to track and populate
let userContact = ''; // Used to track and populate
let inventoryUnsubscribe = null;
let requestsUnsubscribe = null;

function showAuth() {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    if (inventoryUnsubscribe) { inventoryUnsubscribe(); inventoryUnsubscribe = null; }
    if (requestsUnsubscribe) { requestsUnsubscribe(); requestsUnsubscribe = null; }
}

function showDashboard() {
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');

    // Distinct styling/messages for Admins vs Students
    if (role === 'admin') {
        welcomeMsg.innerHTML = `<span class="badge" style="background-color: var(--primary);">Admin</span> Welcome, <strong>${userName}</strong>`;
        adminTools.classList.remove('hidden');
        profileBtn.classList.add('hidden'); // No need for admin to set college ID right now
        requestsTitle.innerHTML = '<i class="fa-solid fa-users-gear"></i> Manage All Requests';
    } else {
        welcomeMsg.innerHTML = `Welcome, <strong>${userName}</strong>`;
        adminTools.classList.add('hidden');
        profileBtn.classList.remove('hidden'); // Ensure visible for students
        requestsTitle.innerHTML = '<i class="fa-solid fa-clipboard-list"></i> My Requests';
    }

    loadInventory();
    loadRequests();
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        // Auto-assign admin if email matches
        const isAdmin = ADMIN_EMAILS.includes(user.email);
        role = isAdmin ? 'admin' : 'student';
        userName = user.displayName || user.email;

        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                const data = userDocSnap.data();
                if (data.college_id) userCollegeId = data.college_id;
                if (data.contact) userContact = data.contact;
            }

            await setDoc(userDocRef, {
                email: user.email,
                name: userName,
                role: role,
                last_login: new Date().toISOString()
            }, { merge: true });

            if (isAdmin) {
                initializeDefaultComponents();
            }
        } catch (e) {
            console.error("Error setting user doc", e);
        }

        showDashboard();
    } else {
        currentUser = null;
        role = null;
        userName = null;
        showAuth();
    }
});

// Seed default components safely
async function initializeDefaultComponents() {
    try {
        const coords = await getDocs(collection(db, "components"));
        if (coords.empty) {
            const sampleComponents = [
                { name: 'Arduino Uno', description: 'ATmega328P Microcontroller board', total_quantity: 10, available_quantity: 10 },
                { name: 'Raspberry Pi 4', description: 'SBC with 4GB RAM', total_quantity: 5, available_quantity: 5 },
                { name: 'ESP32 Module', description: 'Wi-Fi/Bluetooth MCU', total_quantity: 15, available_quantity: 15 },
                { name: 'Breadboard', description: 'Standard size solderless breadboard', total_quantity: 20, available_quantity: 20 },
                { name: 'Multimeter', description: 'Digital Multimeter', total_quantity: 8, available_quantity: 8 }
            ];
            for (const comp of sampleComponents) {
                await addDoc(collection(db, "components"), comp);
            }
        }
    } catch (e) { }
}

// Handle Google Login Click
googleLoginBtn.addEventListener('click', async () => {
    try {
        authError.textContent = "Connecting to Google...";
        await signInWithPopup(auth, googleProvider);
        authError.textContent = "";
    } catch (err) {
        authError.textContent = "Google Sign-In failed: " + err.message;
    }
});

logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
});

// ---------- Core Logic (Inventory) ----------
function loadInventory() {
    if (inventoryUnsubscribe) inventoryUnsubscribe();

    inventoryUnsubscribe = onSnapshot(collection(db, "components"), (snapshot) => {
        const items = [];
        snapshot.forEach(doc => {
            items.push({ id: doc.id, ...doc.data() });
        });
        renderInventory(items);
    });
}

function renderInventory(items) {
    if (items.length === 0) {
        inventoryList.innerHTML = '<p class="card-desc">No parts currently available in inventory.</p>';
        return;
    }

    inventoryList.innerHTML = items.map(i => `
        <div class="card">
            <div class="card-header">
                <span class="card-title">${i.name}</span>
                <span class="badge qty">${i.available_quantity} / ${i.total_quantity} available</span>
            </div>
            <p class="card-desc">${i.description || 'No description'}</p>
            <div class="card-actions">
                ${role === 'admin' ?
            `<button class="btn action-btn outline-btn" onclick="openEditPart('${i.id}', '${i.name}', '${i.description || ''}', ${i.total_quantity}, ${i.available_quantity})"><i class="fa-solid fa-edit"></i> Edit Availability</button>`
            :
            `<button class="btn action-btn primary-btn" ${i.available_quantity > 0 ? '' : 'disabled'} onclick="openRequestPart('${i.id}', '${i.name}', '${i.description}')"><i class="fa-solid fa-hand-holding-hand"></i> Borrow Component</button>`
        }
            </div>
        </div>
    `).join('');
}

// Add Component Logic (Admin)
addComponentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (role !== 'admin') return;

    const name = document.getElementById('new-comp-name').value;
    const desc = document.getElementById('new-comp-desc').value;
    const qty = parseInt(document.getElementById('new-comp-qty').value, 10);
    try {
        await addDoc(collection(db, "components"), {
            name: name,
            description: desc,
            total_quantity: qty,
            available_quantity: qty
        });
        addComponentForm.reset();
    } catch (err) {
        alert("Failed to add component.");
    }
});

// Request (Borrow) Logic (Student)
window.openRequestPart = (id, name, desc) => {
    if (role === 'admin') return;
    document.getElementById('modal-comp-name').textContent = `Borrow ${name}`;
    document.getElementById('modal-comp-desc').textContent = desc || '';
    document.getElementById('modal-comp-id').value = id;
    document.getElementById('modal-comp-qty').value = 1;
    requestModal.classList.remove('hidden');
};

closeBtn.onclick = () => requestModal.classList.add('hidden');
window.onclick = (e) => {
    if (e.target == requestModal) requestModal.classList.add('hidden');
    if (e.target == editModal) editModal.classList.add('hidden');
    if (e.target == profileModal) profileModal.classList.add('hidden');
};

requestPartForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (role === 'admin') return;

    // Safety check - do they have their profile filled?
    if (!userCollegeId || !userContact) {
        alert("Please set your College ID and Contact Number in the Profile section before requesting a part!");
        requestModal.classList.add('hidden');
        openProfileModal();
        return;
    }

    const compId = document.getElementById('modal-comp-id').value;
    const qty = parseInt(document.getElementById('modal-comp-qty').value, 10);
    const compName = document.getElementById('modal-comp-name').textContent.replace('Borrow ', '');

    try {
        await addDoc(collection(db, "requests"), {
            user_id: currentUser.uid,
            user_name: userName,
            email: currentUser.email,
            college_id: userCollegeId || 'Not Provided',
            contact: userContact || 'Not Provided',
            component_id: compId,
            component_name: compName,
            quantity: qty,
            status: 'pending',
            request_date: new Date().toISOString(),
            return_requested: false
        });
        requestModal.classList.add('hidden');
        alert("Request successful! You can view it in your 'My Requests' list.");
    } catch (err) {
        console.error(err);
        alert("Failed to submit request.");
    }
});

// Edit Logic (Admin)
window.openEditPart = (id, name, desc, total_qty, available_qty) => {
    if (role !== 'admin') return;
    document.getElementById('edit-comp-id').value = id;
    document.getElementById('edit-comp-name').value = name;
    document.getElementById('edit-comp-desc').value = desc;
    document.getElementById('edit-comp-qty').value = total_qty;
    editPartForm.dataset.oldTotal = total_qty;
    editPartForm.dataset.oldAvail = available_qty;
    editModal.classList.remove('hidden');
};

closeEditBtn.onclick = () => editModal.classList.add('hidden');

editPartForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (role !== 'admin') return;

    const id = document.getElementById('edit-comp-id').value;
    const name = document.getElementById('edit-comp-name').value;
    const desc = document.getElementById('edit-comp-desc').value;
    const newQty = parseInt(document.getElementById('edit-comp-qty').value, 10);

    const oldTotal = parseInt(editPartForm.dataset.oldTotal, 10);
    const oldAvail = parseInt(editPartForm.dataset.oldAvail, 10);
    const diff = newQty - oldTotal;
    const newAvail = oldAvail + diff;

    if (newAvail < 0) {
        alert("Cannot reduce quantity below currently borrowed amounts.");
        return;
    }

    try {
        await updateDoc(doc(db, "components", id), {
            name: name,
            description: desc,
            total_quantity: newQty,
            available_quantity: newAvail
        });
        editModal.classList.add('hidden');
    } catch (err) {
        alert("Failed to update component.");
    }
});

// ---------- Requests List Logic ----------
function loadRequests() {
    if (requestsUnsubscribe) requestsUnsubscribe();

    let q;
    if (role === 'admin') {
        q = query(collection(db, "requests"), orderBy("request_date", "desc"));
    } else {
        // Query without orderBy to avoid needing a Firestore composite index
        q = query(collection(db, "requests"), where("user_id", "==", currentUser.uid));
    }

    requestsUnsubscribe = onSnapshot(q, (snapshot) => {
        const reqs = [];
        snapshot.forEach(doc => {
            reqs.push({ id: doc.id, ...doc.data() });
        });

        // Sort in-memory to ensure latest is at the top
        reqs.sort((a, b) => new Date(b.request_date) - new Date(a.request_date));

        renderRequests(reqs);
    }, (error) => {
        console.error("Error loading requests:", error);
    });
}

function renderRequests(reqs) {
    if (reqs.length === 0) {
        requestsList.innerHTML = '<p class="card-desc">No requests found.</p>';
        return;
    }
    requestsList.innerHTML = reqs.map(r => `
        <div class="card ${r.return_requested ? 'urgent-return' : ''}">
            <div class="card-header">
                <span class="card-title">${r.component_name} <small>(x${r.quantity})</small></span>
                <span class="badge ${r.status}">${r.status.toUpperCase()}</span>
            </div>
            ${role === 'admin' ? `<p class="card-desc"><strong>Requested By:</strong> ${r.user_name} <br><small><strong>College ID:</strong> ${r.college_id || 'Not Provided'} | <strong>Contact:</strong> ${r.contact || 'Not Provided'} | <strong>Email:</strong> ${r.email || 'N/A'}</small></p>` : ''}
            <p class="card-desc" style="font-size:0.8rem">${new Date(r.request_date).toLocaleString()}</p>
            ${r.return_requested ? '<p class="alert"><i class="fa-solid fa-triangle-exclamation"></i> Admin requested immediate return!</p>' : ''}
            
            <div class="card-actions" style="margin-top: 10px;">
                ${renderActionButtons(r)}
            </div>
        </div>
    `).join('');
}

function renderActionButtons(r) {
    let btns = '';
    if (role === 'admin') {
        if (r.status === 'pending') {
            btns += `<button class="btn action-btn btn-approve" onclick="updateReqStatus('${r.id}', 'approved', '${r.component_id}', ${r.quantity})">Approve</button>`;
            btns += `<button class="btn action-btn btn-reject" onclick="updateReqStatus('${r.id}', 'rejected', null, 0)">Reject</button>`;
        } else if (r.status === 'approved') {
            btns += `<button class="btn action-btn btn-approve" onclick="updateReqStatus('${r.id}', 'returned', '${r.component_id}', ${-r.quantity})">Mark Returned</button>`;
            if (!r.return_requested) {
                btns += `<button class="btn action-btn warning-btn" onclick="requestReturn('${r.id}')"><i class="fa-solid fa-handshake-angle"></i> Ask for Return</button>`;
            }
        }
    } else {
        if (r.status === 'approved') {
            btns += `<button class="btn action-btn outline-btn" disabled>Return at IDEALab desk</button>`;
        }
    }
    return btns;
}

// Admin API Actions
window.updateReqStatus = async (reqId, status, compId, qtyChange) => {
    if (role !== 'admin') return;
    try {
        await updateDoc(doc(db, "requests", reqId), {
            status: status,
            return_requested: false
        });

        // Adjust inventory limits
        if (compId && qtyChange !== 0) {
            await updateDoc(doc(db, "components", compId), {
                available_quantity: increment(-qtyChange)
            });
        }
    } catch (e) {
        alert("Failed to update status.");
    }
};

window.requestReturn = async (reqId) => {
    if (role !== 'admin') return;
    try {
        await updateDoc(doc(db, "requests", reqId), {
            return_requested: true
        });
    } catch (e) {
        alert("Failed to request return.");
    }
};

// ---------- User Profile Logic ----------
function openProfileModal() {
    document.getElementById('profile-college-id').value = userCollegeId;
    document.getElementById('profile-contact').value = userContact;
    profileModal.classList.remove('hidden');
}

profileBtn.addEventListener('click', openProfileModal);

closeProfileBtn.onclick = () => profileModal.classList.add('hidden');

profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newId = document.getElementById('profile-college-id').value;
    const newContact = document.getElementById('profile-contact').value;

    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            college_id: newId,
            contact: newContact
        });
        userCollegeId = newId;
        userContact = newContact;

        // **NEW FIX** Dynamically retroactively update any requests they've made!
        // This makes sure if an admin is currently looking at it, it will auto-populate with the correct info
        const q = query(collection(db, "requests"), where("user_id", "==", currentUser.uid));
        const snapshots = await getDocs(q);
        const updates = [];
        snapshots.forEach((docSnapshot) => {
            updates.push(updateDoc(docSnapshot.ref, {
                college_id: newId,
                contact: newContact
            }));
        });
        await Promise.all(updates);

        profileModal.classList.add('hidden');
        alert("Profile details saved securely.");
    } catch (err) {
        console.error(err);
        alert("Failed to save profile details.");
    }
});
