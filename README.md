# Slopify Web Extension

## 1. Overview

### 1.1 Summary

(Slopify) is a Chrome extension that evaluates websites for Misinformation and Deceptive AI Use:

- Phishing risk  
- AI-generated content likelihood  
- Potential deepfake indicators  

When a user visits a webpage, the extension analyzes page metadata, structure, and content signals, then returns a **0–100 trust score** representing overall risk.
-   0 = Very Safe
-   100 = High Risk

### System Components

The system consists of:

- Chrome Extension (UI + content script)
- Backend API (scoring engine)
- Optional: Database (scan logging + caching)

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Provide a 0–100 risk score 
- Detect common phishing indicators
- Estimate AI-generated content likelihood
- Detect deepfake-related risk signals
- Keep the extension lightweight by separating Logic in the Backend

---

### 2.2 Non-Goals

- ❌ Incorporate AWS (For AWS Route)  
- ❌ Incorporate Database & Valkey API to Cache previously scanned websites

The application focuses strictly on **webpage-level analysis**.

---

## 3. System Architecture
User <br>
↓<br>
Chrome Extension<br>
↓<br>
Backend API<br>
↓<br>
Scoring Engine<br>
↓<br>
Optional: Database<br>
↓<br>
Response (0–100 score)<br>
