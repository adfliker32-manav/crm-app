# My Business CRM — Product Overview

## What Is It?

**My Business** is a **multi-tenant SaaS CRM (Customer Relationship Management)** platform designed for small-to-medium businesses. It helps companies capture, manage, and convert leads through a unified dashboard — combining lead tracking, communication channels, and analytics in one place.

---

## Core Features

### 1. 📊 Dashboard
- Real-time overview of leads, pipeline status, and key metrics
- Revenue tracking and performance summary at a glance

### 2. 👤 Lead Management
- Create, edit, delete, and import leads (supports **Google Sheets / CSV import**)
- **Lead deduplication** to prevent duplicate entries
- Custom lead statuses (New, Contacted, Won, Dead Lead, etc.)
- Add notes, follow-up reminders, and full activity history per lead
- **Custom fields** — managers can define their own fields (text, number, date, dropdown, etc.)
- **Deal value** tracking for revenue forecasting
- Lead assignment to team agents

### 3. 🔀 Pipeline View
- Visual **Kanban-style pipeline** with draggable stages
- Create, rename, and delete custom stages
- Move leads between stages easily

### 4. 📧 Email Management
- Send individual and **bulk emails** to leads
- **Email templates** (create, edit, reuse)
- Email logs and delivery tracking
- Per-user SMTP configuration (supports Gmail App Passwords)

### 5. 💬 WhatsApp Integration
- Send WhatsApp messages to leads via **Meta WhatsApp Business API**
- WhatsApp **message templates** (create and manage)
- WhatsApp message logs and conversation history
- **Webhook support** for receiving incoming WhatsApp messages
- **Chatbot flows** — build automated response logic

### 6. 📱 Meta (Facebook) Lead Sync
- **Facebook OAuth login** to connect your business page
- Sync leads automatically from **Facebook Lead Ads**
- **Meta Conversion API (CAPI)** support for sending lead quality events back to Meta
- Stage-to-funnel mapping for ad optimization

### 7. 👥 Team Management
- **3-Layer role system**: Super Admin → Manager → Agent
- Managers can invite and manage agents
- **Granular permissions** — control access to leads, emails, WhatsApp, pipeline, notes, settings, team, dashboard, and more per agent

### 8. 📈 Reports & Analytics
- Lead source analysis, conversion rates, revenue reports
- Agent performance and response time tracking
- Activity logs for audit trails

### 9. ⚙️ Settings
- Company profile management
- Email & WhatsApp configuration
- Meta/Facebook integration setup
- Subscription & billing info

### 10. 🛡️ Super Admin Panel
- Manage all registered companies/managers
- View subscription plans and overall platform stats
- Platform-wide user and company oversight

---

## Tech Stack

| Layer      | Technology                  |
|------------|-----------------------------|
| Frontend   | React (Vite), React Router  |
| Backend    | Node.js, Express.js         |
| Database   | MongoDB (Mongoose ODM)      |
| Auth       | JWT (JSON Web Tokens), bcrypt|
| Email      | Nodemailer (SMTP)           |
| WhatsApp   | Meta WhatsApp Business API  |
| File Upload| Multer                      |
| Deployment | Render (with keep-alive)    |

---

## User Roles

| Role         | Description                                                        |
|--------------|--------------------------------------------------------------------|
| **Super Admin** | Platform owner. Manages all companies, plans, and global settings. |
| **Manager**     | Company owner. Manages leads, team, integrations, and billing.     |
| **Agent**       | Team member. Works on assigned leads with permission-based access. |

---

## Summary

> **My Business CRM** is an all-in-one lead management and communication platform. It lets businesses capture leads from multiple sources (manual entry, CSV import, Facebook Ads), communicate via Email and WhatsApp, track leads through a visual pipeline, manage teams with role-based permissions, and analyze performance — all from a single web dashboard.
