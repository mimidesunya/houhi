const fs = require('fs');
const path = require('path');

const distPath = path.resolve(__dirname, '..', 'dist');

function main() {
    if (!fs.existsSync(distPath)) {
        process.exit(0);
    }

    try {
        fs.rmSync(distPath, { recursive: true, force: true });
        console.log(`[clean] removed ${distPath}`);
    } catch (error) {
        if (error && (error.code === 'EBUSY' || error.code === 'EPERM')) {
            console.warn(`[clean] warning: could not fully remove ${distPath} (${error.code}). Continuing build with existing dist.`);
            process.exit(0);
        }
        throw error;
    }
}

main();
