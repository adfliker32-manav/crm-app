# Render Deployment Guide

## 🔴 Why Your Deployment Failed

The deployment failed because **required environment variables are missing** in Render. The application requires these variables to start.

---

## ✅ Step-by-Step: Set Environment Variables in Render

### 1. Go to Your Render Dashboard
- Navigate to your service: **crm-app**
- Click on **"Environment"** in the left sidebar

### 2. Add Required Environment Variables

Click **"Add Environment Variable"** and add each of these:

#### **CRITICAL (Required for app to start):**

1. **JWT_SECRET**
   - **Key:** `JWT_SECRET`
   - **Value:** Generate a strong random string (minimum 32 characters)
   - **Example:** `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`
   - **How to generate:** Use an online generator or run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

2. **MONGO_URI**
   - **Key:** `MONGO_URI`
   - **Value:** Your MongoDB connection string
   - **Example:** `mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority`
   - **Note:** If password has special characters, URL-encode them (e.g., `@` → `%40`)

#### **OPTIONAL (But Recommended):**

3. **ENCRYPTION_KEY** (for email/WhatsApp password encryption)
   - **Key:** `ENCRYPTION_KEY`
   - **Value:** A strong random string (minimum 32 characters)
   - **Example:** `my-encryption-key-for-user-credentials-min-32-chars`

4. **VERIFY_TOKEN** (for WhatsApp webhook)
   - **Key:** `VERIFY_TOKEN`
   - **Value:** Your Meta webhook verify token
   - **Example:** `your-webhook-verify-token-123`

5. **PORT** (usually auto-set by Render, but you can override)
   - **Key:** `PORT`
   - **Value:** `10000` (or leave Render to set it automatically)

---

## 📋 Complete Environment Variables List

Add these in Render's Environment section:

```env
# CRITICAL - Required
JWT_SECRET=your-very-strong-random-secret-key-here-min-32-chars
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority

# OPTIONAL - Recommended
ENCRYPTION_KEY=your-encryption-key-for-user-credentials-min-32-chars
VERIFY_TOKEN=your-webhook-verify-token

# CLIENT SIDE (Frontend)
VITE_API_URL=https://your-app-name.onrender.com/api
# Note: For VITE_API_URL, use your actual Render app URL followed by /api
```

---

## 🔧 How to Generate Secure Secrets

### Generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Generate ENCRYPTION_KEY:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or use an online generator: https://randomkeygen.com/

---

## ✅ After Adding Variables

1. **Save** all environment variables in Render
2. **Redeploy** your service (or it will auto-redeploy)
3. Check the **Logs** tab to verify it starts successfully

---

## 🐛 Troubleshooting

### If deployment still fails:

1. **Check Logs** in Render dashboard
2. **Verify** all required variables are set:
   - `JWT_SECRET` ✅
   - `MONGO_URI` ✅
3. **Check MongoDB Connection:**
   - Verify MongoDB Atlas allows connections from Render's IP
   - Add `0.0.0.0/0` to Network Access in MongoDB Atlas (for testing)
4. **Verify MONGO_URI format:**
   - Must start with `mongodb+srv://`
   - Username and password must be correct
   - Special characters in password must be URL-encoded

---

## 📝 Notes

- **Never commit `.env` file to Git** (it's already in `.gitignore`)
- **Environment variables in Render are encrypted** and secure
- **Render automatically restarts** your service when you add/update environment variables
- **PORT** is usually set automatically by Render, but you can override it if needed

---

## ✅ Success Indicators

When deployment succeeds, you should see in logs:
```
✅ MongoDB Connected to Cloud! ☁️
🚀 Server Running on Port 10000
```
