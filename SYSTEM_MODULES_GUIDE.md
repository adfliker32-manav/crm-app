# ADFLIKER CRM: System Architecture & Module Guide

This document provides a comprehensive breakdown of the ADFLIKER CRM system, detailing how each module operates, the core technologies involved, and the interaction between components.

---

## 1. Core Architecture Overview
ADFLIKER is built as a **Multi-Tenant SaaS (Software as a Service)** platform.

- **Data Isolation**: Every database record (Leads, Messages, Settings) is linked to a `userId` (Tenant ID). 
- **Staff Logic**: Main Admins can create "Staff" accounts. These accounts share the same `tenantOwnerId`, allowing team collaboration within a single organization while keeping data isolated from other tenants.
- **Stateless API**: The backend is a Node.js Express server that uses JWT (JSON Web Tokens) for authentication, ensuring scalability and security.

---

## 2. Module Breakdown

### 2.1 Lead Management (The Core)
The Lead Management module is the central repository for all customer data.
- **Lifecycle**: Leads progress through customizable **Stages** (e.g., New, Contacted, Qualified, Closed).
- **Duplicate Prevention**: A specialized `duplicateService` normalizes phone numbers (last 10 digits) and email addresses to prevent "Dirty Data" during imports or manual entry.
- **Custom Fields**: Tenants can define their own data points (e.g., "Property Type," "Budget") which are dynamically rendered in the UI and stored in a flexible `customData` object in MongoDB.
- **Activity Logs**: Every interaction—stage change, note added, or message sent—is logged in the `ActivityLog` collection for a full audit trail.

### 2.2 WhatsApp Communication Hub
WhatsApp is the primary engagement channel for the CRM.
- **Real-Time Messaging**: Uses Meta's Cloud API webhooks to receive messages instantly. The `whatsappWebhookController` validates signatures for security and upserts conversations.
- **Broadcast Campaigns**: Allows sending bulk messages to specific lead segments. It includes a queue system (`broadcastQueueService`) to manage Meta's rate limits and track delivery/read statuses.
- **Media Proxy**: Since Meta's media URLs expire and require auth, the CRM uses a secure **Proxy Layer**. This downloads and caches images/videos locally, serving them to the frontend via authenticated routes.
- **Template Management**: Integration with Meta's Template API allows admins to create and sync pre-approved message templates.

### 2.3 Email & IMAP Service
Provides a full-featured email client experience within the CRM.
- **IMAP Syncing**: The `imapService` uses a sequential polling strategy to fetch incoming emails without overloading the server's CPU. It tracks "UIDs" to ensure no message is processed twice.
- **SMTP Outbound**: Emails are sent via the tenant's own SMTP settings. 
- **Email Tracking**: Every outgoing email can include an invisible tracking pixel and rewritten links to monitor **Opens** and **Clicks**.
- **Automated Lead Creation**: If an email is received from a new address, the system automatically creates a Lead and associates the conversation.

### 2.4 Automation & Trigger Engine
A "Low-Code" engine that handles repetitive tasks.
- **Trigger-Condition-Action (TCA)**:
    - **Triggers**: Lead Created, Stage Changed, Incoming Message, or Webhook Received.
    - **Conditions**: Check if lead data matches specific criteria (e.g., `Budget > 50000`).
    - **Actions**: Send WhatsApp/Email, Update Lead Field, Add Tag, or Notify Admin.
- **Delayed Actions**: Powered by `Agenda`, the system can schedule actions (e.g., "Send a follow-up in 2 days"). If the lead's status changes before the delay expires, the action is automatically cancelled.

### 2.5 Appointment Booking System
A complete workflow for scheduling meetings and site visits.
- **Public Booking Pages**: Each tenant gets a unique URL (`/book/:slug`) where customers can view availability.
- **Slot Management**: Admins define working hours and duration. The system calculates available slots by checking existing appointments and blocking busy times.
- **Auto-Confirmations**: Once a booking is made, the system triggers automated WhatsApp/Email confirmations to both the lead and the admin.

### 2.6 Chatbot Engine
An intelligent layer that handles initial customer queries.
- **Intent Matching**: Uses keyword-based or AI-driven matching to identify what the customer wants.
- **Flow Builder**: Admins can configure automated "Question-Answer" sequences to qualify leads before a human intervenes.
- **Session Control**: Maintains a `Session` state for each user to track where they are in a conversation flow.

### 2.7 Google Sheet & External Sync
Allows seamless data movement between the CRM and other tools.
- **Sheet Sync**: Periodically fetches data from a public/shared Google Sheet (CSV format) and updates CRM leads.
- **Webhook Inbound**: A generic endpoint that allows tools like Zapier, Pabbly, or custom websites to push leads directly into the CRM.

---

## 3. Technical Stack Summary

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React + Vite | Fast, responsive Single Page Application (SPA). |
| **State Management** | Redux Toolkit | Centralized store for leads, chats, and UI state. |
| **Backend** | Node.js (Express) | High-performance API handling. |
| **Database** | MongoDB | Flexible NoSQL storage for multi-tenant data. |
| **Real-Time** | Socket.io | Instant UI updates (New message alerts, Stage updates). |
| **Tasks** | Agenda.js | Persistent background job scheduling. |

---

## 4. Directory Structure Map

- `/src/controllers`: Logic for handling API requests.
- `/src/services`: Core business logic (WhatsApp, Email, Automation).
- `/src/models`: Database schemas and data validation.
- `/src/routes`: API endpoint definitions.
- `/client/src/pages`: UI components and screen logic.
- `/client/src/store`: Redux slices and API hooks.

---
