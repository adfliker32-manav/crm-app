const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(filePath, 'utf-8');

// Add search routes
const routeRegistration = "app.use('/api/search', require('./src/routes/searchRoutes'));";

if (!content.includes('/api/search')) {
    content = content.replace(
        "app.use('/api/activity-logs', require('./src/routes/activityLogRoutes'));",
        "app.use('/api/activity-logs', require('./src/routes/activityLogRoutes'));\napp.use('/api/search', require('./src/routes/searchRoutes'));"
    );

    console.log('✅ Added search routes to server');
    fs.writeFileSync(filePath, content, 'utf-8');
} else {
    console.log('⏭️  Search routes already registered');
}
