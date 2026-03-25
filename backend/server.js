const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors()); 
app.use(express.json());

// Serve static files from the 'backend' directory and uploads
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer for Audio Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.endsWith('.mp4') ? '.mp4' : '.m4a';
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// Route strictly for the dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

const DB_FILE = path.join(__dirname, 'activeEmergencies.json');

// Load persistence
let activeEmergencies = {};
try {
    if (fs.existsSync(DB_FILE)) {
        const rawData = fs.readFileSync(DB_FILE, 'utf-8');
        activeEmergencies = JSON.parse(rawData);
        console.log(`[Persistence] Loaded ${Object.keys(activeEmergencies).length} active sessions.`);
    }
} catch (e) {
    console.warn("[Persistence] Failed to load data. Starting fresh.");
}

function saveState() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(activeEmergencies, null, 2));
    } catch (e) {
        console.error("[Persistence] Failed to write to disk:", e);
    }
}

// 🛰️ Dead-Man's Switch: Monitors for 30s of silence
setInterval(() => {
    const NOW = Date.now();
    let stateChanged = false;

    Object.keys(activeEmergencies).forEach(id => {
        const session = activeEmergencies[id];
        if (NOW - session.lastSeen > 30000 && session.status !== "LOST" && session.triggerType !== "USER_REPORTED_SAFE") {
            session.status = "LOST";
            session.triggerType = "DEAD_MAN_SWITCH"; // explicitly set for dashboard
            io.emit('deadManSwitch', { userId: id });
            console.log(`[ALERT] Dead-man switch activated for victim: ${id}`);
            stateChanged = true;
        }
    });

    if(stateChanged) saveState();

}, 5000);

app.post('/location', (req, res) => {
    console.log(`[UPLINK] Incoming Signal: ${req.body.triggerType} from ${req.body.userId}`);
    try {
        const { userId, latitude, longitude, battery, triggerType } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const isSafe = triggerType === "USER_REPORTED_SAFE";

        if (isSafe && activeEmergencies[userId]) {
            // Handle safe cleanup
            delete activeEmergencies[userId];
            io.emit('updatePoliceMap', { userId, triggerType: "USER_REPORTED_SAFE" });
            console.log(`[CLEARED] User ${userId} marked safe.`);
            saveState();
            return res.sendStatus(200);
        }

        activeEmergencies[userId] = { 
            userId, 
            latitude, 
            longitude, 
            battery, 
            lastSeen: Date.now(), 
            triggerType,
            status: activeEmergencies[userId]?.status === "LOST" ? "RECOVERED" : "ACTIVE"
        };
        
        io.emit('updatePoliceMap', activeEmergencies[userId]);
        saveState();
        res.sendStatus(200);
    } catch (error) {
        console.error("[Router] Error handling location update:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/api/state', (req, res) => {
    res.json(activeEmergencies);
});

app.post('/upload-audio', upload.single('audio'), (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId || !req.file) {
            return res.status(400).json({ error: "userId and audio file are required" });
        }

        const fileUrl = `/uploads/${req.file.filename}`;
        const type = req.file.originalname.endsWith('.mp4') ? 'video' : 'audio';
        
        // Associate with persistent session
        if (activeEmergencies[userId]) {
            if (type === 'video') {
                activeEmergencies[userId].videoUrl = fileUrl;
            } else {
                activeEmergencies[userId].audioUrl = fileUrl;
            }
            activeEmergencies[userId].lastSeen = Date.now();
            saveState();
        }

        // Broadcast to dashboard
        io.emit('evidenceUpload', { userId, fileUrl: fileUrl, type });
        console.log(`[EVIDENCE] New ${type} uploaded for ${userId}: ${fileUrl}`);

        res.status(200).json({ success: true, fileUrl: fileUrl, type });
    } catch (error) {
        console.error("[Audio] Upload error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

// Endpoint to fetch all recorded evidence files
app.get('/api/evidence', (req, res) => {
    try {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) return res.json([]);

        const files = fs.readdirSync(uploadDir);
        const fileData = files.map(file => {
            const stats = fs.statSync(path.join(uploadDir, file));
            return {
                filename: file,
                url: `/uploads/${file}`,
                time: stats.mtime.getTime(),
                type: file.endsWith('.mp4') ? 'video' : 'audio'
            };
        }).sort((a, b) => b.time - a.time); // Newest first

        res.json(fileData);
    } catch (e) {
        console.error("Failed to read evidence:", e);
        res.status(500).json({ error: "Failed to load evidence" });
    }
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("====================================");
    console.log("🛡️ SafeBand Command Bridge 🛡️");
    console.log("====================================");
    console.log(`Dashboard: http://localhost:${PORT}/`);
    console.log(`Listening for uplinks on port ${PORT}...`);
});