const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(filePath, 'utf-8');

// Add activity log routes after meta routes
const routeRegistration = "app.use('/api/activity-logs', require('./src/routes/activityLogRoutes'));";

if (!content.includes('activity-log')) {
    // Find the meta routes line
    const metaRoutesPattern = /app\.use\('\/api\/meta', metaRoutes\);/;

    content = content.replace(
        metaRoutesPattern,
        `app.use('/api/meta', metaRoutes);\napp.use('/api/activity-logs', require('./src/routes/activityLogRoutes'));`
    );

    console.log('✅ Added activity log routes to server');
    fs.writeFileSync(filePath, content, 'utf-8');
} else {
    console.log('⏭️  Activity log routes already registered');
}
