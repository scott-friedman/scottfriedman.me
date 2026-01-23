#!/usr/bin/env node
/**
 * Parse Whisker CSV and update Firebase history with correct data
 */

const fs = require('fs');
const https = require('https');

const FIREBASE_URL = 'https://scottfriedman-f400d-default-rtdb.firebaseio.com';
const CSV_PATH = '/Users/scott/Downloads/whisker_activity_2026-01-22.csv';

// Parse the Whisker CSV
function parseWhiskerCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const data = {};

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split by comma, handling the format: Activity,M/D time,Value
        const parts = line.split(',');
        if (parts.length < 3) continue;

        const activity = parts[0];
        const timestamp = parts[1];
        const value = parts.slice(2).join(','); // In case value has commas

        // Parse timestamp like "1/22 3:39 pm" or "12/26 9:48 pm"
        const dateMatch = timestamp.match(/(\d+)\/(\d+)/);
        if (!dateMatch) continue;

        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);

        // Assume 2026 for Jan dates, 2025 for Dec dates
        const year = month === 12 ? 2025 : 2026;
        const fullDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        if (!data[fullDate]) {
            data[fullDate] = { visits: 0, cycles: 0, weights: [] };
        }

        if (activity === 'Cat detected') {
            data[fullDate].visits++;
        } else if (activity === 'Clean Cycle Complete') {
            data[fullDate].cycles++;
        } else if (activity === 'Weight recorded') {
            const weightMatch = value.match(/([\d.]+)\s*lbs/);
            if (weightMatch) {
                const weight = parseFloat(weightMatch[1]);
                // Filter out obviously wrong weights (like 4.9, 5.7 which were errors)
                if (weight >= 10 && weight <= 13) {
                    data[fullDate].weights.push(weight);
                }
            }
        }
    }

    // Calculate average weight for each day
    for (const date of Object.keys(data)) {
        const weights = data[date].weights;
        if (weights.length > 0) {
            data[date].avgWeight = parseFloat((weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2));
        }
        delete data[date].weights; // Don't need individual weights for history
    }

    return data;
}

// Get existing Firebase data
function getFirebaseData() {
    return new Promise((resolve, reject) => {
        https.get(`${FIREBASE_URL}/litterrobot/history.json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data) || {});
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log('Reading Whisker CSV...');
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    const whiskerData = parseWhiskerCSV(csvContent);

    const dates = Object.keys(whiskerData).sort();
    console.log(`\nParsed ${dates.length} days from Whisker (${dates[0]} to ${dates[dates.length-1]}):\n`);

    console.log('Date         | Visits | Cycles | Avg Weight');
    console.log('-------------|--------|--------|----------');

    for (const date of dates) {
        const d = whiskerData[date];
        console.log(`${date} | ${d.visits.toString().padStart(6)} | ${d.cycles.toString().padStart(6)} | ${d.avgWeight ? d.avgWeight.toFixed(1) : '--'}`);
    }

    console.log('\nFetching existing Firebase data...');
    const existingData = await getFirebaseData();

    console.log('\nComparing data:\n');
    console.log('Date         | FB Vis | WH Vis | FB Cyc | WH Cyc | Status');
    console.log('-------------|--------|--------|--------|--------|--------');

    const corrections = [];

    for (const date of dates) {
        const whisker = whiskerData[date];
        const firebase = existingData[date] || { visits: 0, cycles: 0 };

        const visitsDiff = whisker.visits !== (firebase.visits || 0);
        const cyclesDiff = whisker.cycles !== (firebase.cycles || 0);
        const needsUpdate = visitsDiff || cyclesDiff;

        const status = needsUpdate ? 'DIFF' : 'OK';

        if (needsUpdate || !existingData[date]) {
            console.log(`${date} | ${(firebase.visits || 0).toString().padStart(6)} | ${whisker.visits.toString().padStart(6)} | ${(firebase.cycles || 0).toString().padStart(6)} | ${whisker.cycles.toString().padStart(6)} | ${status}`);
            corrections.push({ date, data: whisker });
        }
    }

    if (corrections.length === 0) {
        console.log('\nAll data matches! No corrections needed.');
        return;
    }

    console.log(`\n${corrections.length} days need updates.`);
    console.log('\n--- CURL COMMANDS TO UPDATE FIREBASE ---\n');

    for (const { date, data } of corrections) {
        const payload = JSON.stringify(data);
        console.log(`curl -X PATCH '${FIREBASE_URL}/litterrobot/history/${date}.json' -d '${payload}'`);
    }

    console.log('\n--- OR RUN ALL AT ONCE ---\n');

    // Build a single PATCH for all corrections
    const allUpdates = {};
    for (const { date, data } of corrections) {
        allUpdates[date] = data;
    }
    console.log(`curl -X PATCH '${FIREBASE_URL}/litterrobot/history.json' -d '${JSON.stringify(allUpdates)}'`);
}

main().catch(console.error);
