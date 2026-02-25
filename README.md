# Student Dental Records System (Jagna, Bohol)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/arungtaab/dental-records?style=social)](https://github.com/arungtaab/dental-records/stargazers)
![Language](https://img.shields.io/github/languages/top/arungtaab/dental-records)
![Status](https://img.shields.io/badge/status-in%20progress-yellow)
 


An **offline-first, Progressive Web App** designed for dental health outreach in the remote barangays of Jagna, Bohol, Philippines. This system enables community health workers and visiting medical teams to record patient examinations without an internet connection, automatically syncing data to a central Google Sheet when connectivity is restored.


## The Story & Problem

Operating in Jagna, Bohol presents unique challenges:
- **Geographic Dispersion:** Patients are spread across mountainous upland barangays, often over 40 minutes from the town center.
- **Unreliable Connectivity:** Internet access in these rural areas is intermittent and unstable.
- **Limited Digital Literacy:** Local health workers may have limited experience with complex digital tools.
- **Manpower Constraints:** Medical teams are small, and previous attempts to digitize records using paper-to-digital workflows failed due to a lack of follow-up and unsustainable processes.

**The goal was to build a simple, resilient, and intuitive tool that works in these conditions, not despite them.**

## Solution Overview

This system is a custom-coded Progressive Web App (PWA) that functions as a complete digital clinic management tool. It is split into three core modules, accessible via a simple tab interface:

1. **Patient Records & Dental Exam (Tab 1):** Search, create, and edit patient records. The centerpiece is an interactive FDI tooth chart that allows for rapid, visual recording of dental conditions.
2. **Analytics Dashboard (Tab 2):** A real-time dashboard that visualizes DMFT scores, cavity-free percentages, school performance, and common treatments, providing instant insights for the medical team.
3. **Booking System (Tab 3):** A separate, integrated module for managing appointments and patient schedules.

The entire application is designed with a **mobile-first, offline-first** philosophy, using the browser's local storage (`IndexedDB`) as the primary database and syncing with the cloud only when a reliable connection is available.

## Key Features

- **100% Offline Capable:** Built with a Service Worker and `IndexedDB`, the app functions perfectly in the most remote areas without internet.
- **Interactive FDI Tooth Chart:** A visual, clickable chart replaces complex dropdowns. A single tap cycles a tooth's status (Normal, Decayed, Filled, Missing, For Extraction), automatically compiling the FDI numbers into the correct data fields.
- **Real-Time Analytics Dashboard:** Aggregates data from all local records to display key performance indicators (KPIs) like Average DMFT, Cavity-Free Percentage, and school-wise comparisons, helping the team make data-driven decisions on the fly.
- **Seamless Cloud Sync:** When a connection is restored, all locally saved records are automatically synchronized with a Google Sheet, acting as a free, serverless, and reliable cloud backend via Google Apps Script.

## Technology Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Local Storage:** IndexedDB (via native browser API)
- **Backend / Sync Layer:** Google Apps Script (handles data saving/searching) & Google Sheets (the primary database)
- **Charts:** Chart.js
- **PWA Features:** Service Worker, Web App Manifest

## Getting Started / Local Setup

This project is a static site that can be run locally or hosted on any static web server (like GitHub Pages).

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge).
- A Google account to set up the backend sheet.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/arungtaab/dental-records.git
   cd dental-records
2. **Set up the Google Sheets Backend (Apps Script):**
   Create a new Google Sheet. This will be your primary database.
   Go to Extensions > Apps Script.
   Delete any code in the editor and paste the contents of the Code.gs file from this repository.
   In the Apps Script editor, click Deploy > New Deployment. Choose "Web App", set "Execute as" to "Me", and "Who has access" to "Anyone".
   Click "Deploy" and copy the generated Web App URL. You will need this for the next step.
3. **Configure the Frontend:**
   Open the app.js file.
   Find the line starting with const APPS_SCRIPT_URL = ... and paste the URL you copied from the Apps Script deployment.
   *(Optional) If you want to modify the Google Sheet structure, you must update the fieldToHeader mapping in Code.gs and the corresponding form fields in index.html.*
4. **Run the Application:**
   You can simply open the index.html file in your browser.
   For the best experience (and to test service workers), serve the folder using a local development server (e.g., with the Live Server extension in VS Code or Python's http.server).

### Project Structure

dental-records/
├── index.html
├── styles.css
├── app.js
├── sw.js
├── manifest.json
├── analysis-dashboard/
│   └── index.html
├── booking-system/
│   └── index.html
└── README.md

### How To Use
1. **Adding a Patient:**
   Go to "Tab 1", click "New Student", fill in the required information, and click "Save Student Info". This creates an initial "empty" exam record for the student.
2. **Recording an Exam:**
   Search for a student by name, DOB, and school.
   Their information will load. Click on the teeth in the FDI chart to mark their condition.
   Fill in any additional notes in the form below the chart.
   Click "Save Dental Record". The data is saved locally and will sync to the Google Sheet when online.
3. **Viewing Analytics:**
   Switch to "Tab 2". The dashboard automatically reads data from your local IndexedDB. Click "Sync from Server" to pull the latest data from the Google Sheet.
4. **Offline Use:**
   The app works exactly the same without an internet connection. Any records you save will appear in the "Previous Records" list and will be synced automatically the next time you are online.

### Testing the Sync & Offline Functionality
**Online:** Add a new patient and a dental exam. Check your Google Sheet to confirm the data appears.

**Offline:** Put your browser in offline mode (or turn off your WiFi). Refresh the page and search for the patient you added. Their information and previous exams should still be visible.

**Reconnect:** Turn your internet back on. Any new records you created while offline will automatically sync to the Google Sheet. You can also use the "Sync from Server" button in the dashboard to pull any changes made by other users.

## License

This project is licensed under the MIT License – you are free to use, modify, and distribute it as long as the original copyright and license notice are included. The full license text can be found at [https://opensource.org/licenses/MIT](https://opensource.org/licenses/MIT).

## Acknowledgements

- **Philos Health & the community health workers in Jagna, Bohol** for providing the context, challenges, and inspiration for this project.
- **Teeth icons** created by [Freepik](https://www.flaticon.com/authors/freepik) from [Flaticon](https://www.flaticon.com/).
- **Chart.js** for the analytics dashboard.
- **FullCalendar** for the booking system.
- **All open‑source contributors** whose libraries made this project possible.


   
