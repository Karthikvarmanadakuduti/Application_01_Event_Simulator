const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
const xlsx = require("xlsx");
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// --- Database Connection ---
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "", 
    database: "buttonsdb",
    dateStrings: true // Preserve milliseconds
});

db.connect((err) => {
    if (err) { console.error("❌ MySQL Connection error:", err); process.exit(1); }
    console.log("MySQL connected successfully...");
});

// --- Excel Loading ---
const excelDataDir = path.join(__dirname, "excel_data");
const stationsPath = path.join(excelDataDir, "stations.xlsx");
let stationsList = [];

try {
    const workbook = xlsx.readFile(stationsPath);
    stationsList = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
} catch (err) { console.error("Failed to load master stations list."); }

app.get("/stations", (req, res) => res.json(stationsList));

// --- API Endpoints ---
app.get("/channels/:stationId", (req, res) => {
    const station = stationsList.find(s => s['Station ID'] === req.params.stationId);
    if (!station) return res.status(404).json({ error: "Station not found" });

    const excelPath = path.join(excelDataDir, station['Excel File']);
    if (!fs.existsSync(excelPath)) return res.status(404).json({ error: "Excel file not found" });

    try {
        const workbook = xlsx.readFile(excelPath);
        const channels = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const processedChannels = channels.map(ch => {
            // Robust parsing: extract the first digit found in "Default States"
            const rawDefault = String(ch['Default States'] || '0');
            const match = rawDefault.match(/[01]/); 
            const statusCode = match ? match[0] : '0'; 

            return {
                ...ch,
                'Channel Number': String(ch['Channel Number']).padStart(4, '0'),
                'Description': ch['Description'] || 'No Description',
                'DefaultStatusCode': statusCode // Used to set 0=Green, 1=Red
            };
        });
        res.json(processedChannels);
    } catch (err) { res.status(500).json({ error: "Excel processing failed" }); }
});

app.post("/event", (req, res) => {
    const { ch_no, status, station_id } = req.body;
    const upsert = `INSERT INTO channel_status (station_id, ch_no, status) VALUES (?, ?, ?) 
                   ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP`;
    db.query(upsert, [station_id, ch_no, status], (err) => {
        if (err) return res.status(500).send("DB error");
        db.query("INSERT INTO events (station_id, ch_no, status) VALUES (?, ?, ?)", [station_id, ch_no, status], () => {
            res.json({ success: true });
        });
    });
});

app.get("/events/:stationId", (req, res) => {
    const query = "SELECT * FROM events WHERE station_id = ? ORDER BY created_at DESC LIMIT 20";
    db.query(query, [req.params.stationId], (err, results) => {
        if (err) return res.status(500).send("Fetch error");
        res.json(results);
    });
});

app.get("/status/:stationId", (req, res) => {
    db.query("SELECT ch_no, status FROM channel_status WHERE station_id = ?", [req.params.stationId], (err, results) => {
        const map = results.reduce((acc, row) => { acc[row.ch_no] = String(row.status); return acc; }, {});
        res.json(map);
    });
});

app.use(express.static(path.join(__dirname, "public")));
app.listen(3005, () => console.log("Server active: http://localhost:3005"));