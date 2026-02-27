const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'idealab_secret_sauce'; // Use a proper secret in production

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Setup database
const dbFile = path.join(__dirname, 'idealab.db');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        college_id TEXT UNIQUE,
        password_hash TEXT,
        role TEXT DEFAULT 'student',
        name TEXT
    )`);

    // Create default admin if not exists
    db.get("SELECT * FROM users WHERE role = 'admin'", async (err, row) => {
        if (!row) {
            const hash = await bcrypt.hash('admin123', 10);
            db.run(`INSERT INTO users (college_id, password_hash, role, name) VALUES (?, ?, ?, ?)`, ['admin', hash, 'admin', 'IDEALab Admin']);
        }
    });

    // Components inventory table
    db.run(`CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        total_quantity INTEGER,
        available_quantity INTEGER
    )`);

    // Add some sample components if empty
    db.get("SELECT COUNT(*) AS count FROM components", (err, row) => {
        if (row && row.count === 0) {
            const sampleComponents = [
                ['Arduino Uno', 'Microcontroller board based on the ATmega328P', 10, 10],
                ['Raspberry Pi 4', 'SBC with 4GB RAM', 5, 5],
                ['Breadboard', 'Standard size solderless breadboard', 20, 20],
                ['Multimeter', 'Digital Multimeter', 8, 8],
                ['Soldering Iron', 'Temperature controlled soldering station', 4, 4]
            ];
            const stmt = db.prepare(`INSERT INTO components (name, description, total_quantity, available_quantity) VALUES (?, ?, ?, ?)`);
            sampleComponents.forEach(c => stmt.run(c));
            stmt.finalize();
        }
    });

    // Borrow Requests table
    db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        component_id INTEGER,
        quantity INTEGER,
        status TEXT DEFAULT 'pending', -- pending, approved, rejected, returned
        request_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        return_requested BOOLEAN DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(component_id) REFERENCES components(id)
    )`);
});

// Middleware for auth
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.sendStatus(403);
    }
};

// --- AUTH ROUTES ---

// Signup
app.post('/api/auth/signup', async (req, res) => {
    const { college_id, password, name } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (college_id, password_hash, name, role) VALUES (?, ?, ?, ?)`, 
            [college_id, hash, name, 'student'], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'College ID already registered.' });
                }
                return res.status(500).json({ error: 'Database error.' });
            }
            res.json({ message: 'User created successfully.', user_id: this.lastID });
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { college_id, password } = req.body;
    db.get(`SELECT * FROM users WHERE college_id = ?`, [college_id], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Invalid college ID or password.' });
        
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid college ID or password.' });

        const token = jwt.sign({ id: user.id, college_id: user.college_id, role: user.role, name: user.name }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, role: user.role, name: user.name });
    });
});

// --- COMPONENT ROUTES ---

// Get all components
app.get('/api/components', authenticate, (req, res) => {
    db.all(`SELECT * FROM components`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin add component
app.post('/api/components', authenticate, authorizeAdmin, (req, res) => {
    const { name, description, quantity } = req.body;
    db.run(`INSERT INTO components (name, description, total_quantity, available_quantity) VALUES (?, ?, ?, ?)`,
        [name, description, quantity, quantity], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Component added.', id: this.lastID });
    });
});

// Admin update component
app.put('/api/components/:id', authenticate, authorizeAdmin, (req, res) => {
    const { id } = req.params;
    const { name, description, quantity } = req.body;
    db.get('SELECT total_quantity, available_quantity FROM components WHERE id = ?', [id], (err, comp) => {
        if (err || !comp) return res.status(404).json({error: 'Not found'});
        const difference = quantity - comp.total_quantity;
        const newAvailable = comp.available_quantity + difference;
        if(newAvailable < 0) return res.status(400).json({error: 'Cannot reduce quantity below borrowed amounts'});

        db.run(`UPDATE components SET name=?, description=?, total_quantity=?, available_quantity=? WHERE id=?`,
            [name, description, quantity, newAvailable, id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Component updated.' });
        });
    });
});

// --- BORROW REQUESTS ROUTES ---

// Student: get my requests
app.get('/api/requests/me', authenticate, (req, res) => {
    db.all(`SELECT r.*, c.name, c.description FROM requests r 
            JOIN components c ON r.component_id = c.id 
            WHERE r.user_id = ? ORDER BY r.request_date DESC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin: get all pending/active requests
app.get('/api/requests', authenticate, authorizeAdmin, (req, res) => {
    db.all(`SELECT r.*, c.name as component_name, u.name as user_name, u.college_id 
            FROM requests r 
            JOIN components c ON r.component_id = c.id 
            JOIN users u ON r.user_id = u.id
            ORDER BY r.request_date DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Student: request to borrow
app.post('/api/requests', authenticate, (req, res) => {
    const { component_id, quantity } = req.body;
    // Check if component has enough available inventory
    db.get('SELECT available_quantity FROM components WHERE id = ?', [component_id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Component not found.' });
        if (row.available_quantity < quantity) {
            return res.status(400).json({ error: 'Not enough available component.' });
        }
        
        // Let user request it, we'll deduct only when approved to prevent race condition abuses
        // Or deduct it right away on pending? Usually pending shouldn't deduct until approved, 
        // but for a simple demo let's assume pending requests deduct so others don't request it
        // Actually, let's just make it 'approved' instantly or admin approves it. Let's make it manual approval.
        db.run(`INSERT INTO requests (user_id, component_id, quantity, status) VALUES (?, ?, ?, ?)`,
            [req.user.id, component_id, quantity, 'pending'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Request submitted.', request_id: this.lastID });
        });
    });
});

// Admin: Change request status
app.patch('/api/requests/:id/status', authenticate, authorizeAdmin, (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'approved', 'rejected', 'returned'
    
    db.get(`SELECT status, component_id, quantity FROM requests WHERE id = ?`, [id], (err, reqRow) => {
        if (err || !reqRow) return res.status(404).json({ error: 'Request not found.' });

        const currentStatus = reqRow.status;
        if (currentStatus === status) return res.json({ message: 'No change needed.' });

        // Handling logic for inventory availability
        db.get(`SELECT available_quantity FROM components WHERE id = ?`, [reqRow.component_id], (err, comp) => {
            if (err || !comp) return res.status(500).json({ error: 'Component not found.' });

            let qtyChange = 0;
            if (currentStatus === 'pending' && status === 'approved') {
                if (comp.available_quantity < reqRow.quantity) return res.status(400).json({ error: 'Not enough inventory.' });
                qtyChange = -reqRow.quantity; // Deduct available
            } else if (currentStatus === 'approved' && status === 'returned') {
                qtyChange = reqRow.quantity; // Add back available
            } else if (currentStatus === 'approved' && status === 'rejected') {
                qtyChange = reqRow.quantity; // Add back available
            }
            
            db.run(`UPDATE requests SET status = ?, return_requested = 0 WHERE id = ?`, [status, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                if (qtyChange !== 0) {
                    db.run(`UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?`, [qtyChange, reqRow.component_id], (err) => {
                        if(err) return res.status(500).json({ error: err.message });
                        res.json({ message: 'Status updated successfully.' });
                    });
                } else {
                    res.json({ message: 'Status updated successfully.' });
                }
            });
        });
    });
});

// Admin: Request return from student
app.post('/api/requests/:id/request-return', authenticate, authorizeAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE requests SET return_requested = 1 WHERE id = ? AND status = 'approved'`, [id], (err) => {
         if (err) return res.status(500).json({ error: err.message });
         res.json({ message: 'Return requested.' });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
