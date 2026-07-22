'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const AdmZip = require('adm-zip');

const repoRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(repoRoot, 'release');
const packageName = 'houhi-win-x64';
const packageDir = path.join(releaseRoot, packageName);
const pdfJsSourceDir = path.join(repoRoot, 'node_modules', 'pdfjs-dist');
const pdfJsDestinationDir = path.join(packageDir, 'app', 'node_modules', 'pdfjs-dist');
const requiredFiles = [
    path.join('legacy', 'build', 'pdf.mjs'),
    path.join('legacy', 'build', 'pdf.worker.mjs'),
];
const requiredDirectories = ['image_decoders'];
const requiredRuntimeFiles = [
    path.join('app', 'dist', 'src', 'lib', 'pdfjs_loader.js'),
    path.join('app', 'node_modules', '@napi-rs', 'canvas', 'index.js'),
    path.join('app', 'node_modules', '@napi-rs', 'canvas-win32-x64-msvc', 'skia.win32-x64-msvc.node'),
    path.join('runtime', 'node', 'node.exe'),
];

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '-',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
}

function sanitizeReleaseLabel(value) {
    return String(value || '')
        .trim()
        .replace(/^refs\/tags\//, '')
        .replace(/^refs\/heads\//, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function assertInside(parentPath, targetPath) {
    const parent = path.resolve(parentPath);
    const target = path.resolve(targetPath);
    const relative = path.relative(parent, target);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        return;
    }
    throw new Error(`Refusing path outside ${parent}: ${target}`);
}

function copyDirectory(source, destination, destinationRoot) {
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link in PDF.js assets: ${source}`);
    }
    if (!sourceStat.isDirectory()) {
        throw new Error(`Expected PDF.js asset directory: ${source}`);
    }

    assertInside(destinationRoot, destination);
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        assertInside(destinationRoot, destinationPath);
        if (entry.isSymbolicLink()) {
            throw new Error(`Refusing symbolic link in PDF.js assets: ${sourcePath}`);
        }
        if (entry.isDirectory()) {
            copyDirectory(sourcePath, destinationPath, destinationRoot);
        } else if (entry.isFile()) {
            fs.copyFileSync(sourcePath, destinationPath);
        }
    }
}

function copyPdfJsAssets(sourceDir, destinationDir) {
    for (const relativePath of requiredFiles) {
        const sourcePath = path.join(sourceDir, relativePath);
        const destinationPath = path.join(destinationDir, relativePath);
        assertInside(sourceDir, sourcePath);
        assertInside(destinationDir, destinationPath);
        if (!fs.statSync(sourcePath).isFile()) {
            throw new Error(`Missing PDF.js release asset: ${sourcePath}`);
        }
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
    }

    for (const directory of requiredDirectories) {
        const sourcePath = path.join(sourceDir, directory);
        const destinationPath = path.join(destinationDir, directory);
        assertInside(sourceDir, sourcePath);
        copyDirectory(sourcePath, destinationPath, destinationDir);
    }
}

function assertPdfJsAssets(destinationDir) {
    for (const relativePath of requiredFiles) {
        const destinationPath = path.join(destinationDir, relativePath);
        assertInside(destinationDir, destinationPath);
        if (!fs.existsSync(destinationPath) || !fs.statSync(destinationPath).isFile()) {
            throw new Error(`Release output is missing PDF.js asset: ${destinationPath}`);
        }
    }
    for (const directory of requiredDirectories) {
        const destinationPath = path.join(destinationDir, directory);
        assertInside(destinationDir, destinationPath);
        if (!fs.existsSync(destinationPath) || !fs.statSync(destinationPath).isDirectory()) {
            throw new Error(`Release output is missing PDF.js directory: ${destinationPath}`);
        }
        if (fs.readdirSync(destinationPath).length === 0) {
            throw new Error(`Release output has empty PDF.js directory: ${destinationPath}`);
        }
    }
}

function addDirectoryToZip(zip, directory, root) {
    assertInside(root, directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        assertInside(root, fullPath);
        if (entry.isSymbolicLink()) {
            throw new Error(`Refusing symbolic link in release output: ${fullPath}`);
        }
        if (entry.isDirectory()) {
            addDirectoryToZip(zip, fullPath, root);
        } else if (entry.isFile()) {
            const zipEntryPath = path.relative(root, fullPath).replace(/\\/g, '/');
            const zipDirectory = path.posix.dirname(zipEntryPath);
            zip.addLocalFile(fullPath, zipDirectory === '.' ? '' : zipDirectory);
        }
    }
}

function rebuildZip(packagePath, zipPath, allowedReleaseRoot = releaseRoot) {
    const root = path.dirname(packagePath);
    assertInside(allowedReleaseRoot, packagePath);
    assertInside(allowedReleaseRoot, zipPath);
    const zip = new AdmZip();
    addDirectoryToZip(zip, packagePath, root);
    zip.writeZip(zipPath);
}

function postprocessPdfJsAssets(options = {}) {
    const sourceDir = options.sourceDir || pdfJsSourceDir;
    const destinationDir = options.destinationDir || pdfJsDestinationDir;
    const targetPackageDir = options.packageDir || packageDir;
    const targetZipPath = options.zipPath;
    const allowedReleaseRoot = options.releaseRoot || releaseRoot;
    copyPdfJsAssets(sourceDir, destinationDir);
    assertPdfJsAssets(destinationDir);
    if (targetZipPath) {
        rebuildZip(targetPackageDir, targetZipPath, allowedReleaseRoot);
        const zip = new AdmZip(targetZipPath);
        const prefix = `${path.basename(targetPackageDir)}/app/node_modules/pdfjs-dist/`;
        for (const relativePath of requiredFiles) {
            if (!zip.getEntry(prefix + relativePath.replace(/\\/g, '/'))) {
                throw new Error(`ZIP output is missing PDF.js asset: ${relativePath}`);
            }
        }
    }
}

function assertReleaseRuntime(targetPackageDir = packageDir, targetZipPath) {
    for (const relativePath of requiredRuntimeFiles) {
        const targetPath = path.join(targetPackageDir, relativePath);
        assertInside(targetPackageDir, targetPath);
        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
            throw new Error(`Release output is missing PDF runtime file: ${targetPath}`);
        }
    }

    const appDir = path.join(targetPackageDir, 'app');
    const nodePath = path.join(targetPackageDir, 'runtime', 'node', 'node.exe');
    const probe = [
        "const { createCanvas } = require('@napi-rs/canvas');",
        "const canvas = createCanvas(1, 1);",
        "const context = canvas.getContext('2d');",
        "context.fillStyle = '#000';",
        "context.fillRect(0, 0, 1, 1);",
        "if (context.getImageData(0, 0, 1, 1).data[3] !== 255) process.exit(2);",
        "require('./dist/src/lib/pdfjs_loader.js').loadPdfJs()",
        "  .then(pdfjs => { if (typeof pdfjs.getDocument !== 'function') process.exit(3); })",
        "  .catch(error => { console.error(error); process.exit(4); });",
    ].join('');
    const result = childProcess.spawnSync(nodePath, ['-e', probe], {
        cwd: appDir,
        encoding: 'utf-8',
        windowsHide: true,
        shell: false,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`Packaged PDF runtime probe failed with status ${result.status}${details ? `:\n${details}` : ''}`);
    }

    if (targetZipPath) {
        const zip = new AdmZip(targetZipPath);
        const prefix = `${path.basename(targetPackageDir)}/`;
        for (const relativePath of requiredRuntimeFiles) {
            const zipEntryPath = prefix + relativePath.replace(/\\/g, '/');
            if (!zip.getEntry(zipEntryPath)) {
                throw new Error(`ZIP output is missing PDF runtime file: ${relativePath}`);
            }
        }
    }
}

function main() {
    const releaseTimestamp = process.env.HOUHI_RELEASE_TIMESTAMP || formatTimestamp(new Date());
    const releaseLabel = sanitizeReleaseLabel(process.env.HOUHI_RELEASE_LABEL || process.env.GITHUB_REF_NAME);
    const releaseSuffix = releaseLabel || releaseTimestamp;
    const zipPath = path.join(releaseRoot, `${packageName}-${releaseSuffix}.zip`);
    assertInside(releaseRoot, zipPath);

    const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'package_windows_release.js')], {
        cwd: repoRoot,
        env: { ...process.env, HOUHI_RELEASE_TIMESTAMP: releaseTimestamp },
        stdio: 'inherit',
        windowsHide: true,
        shell: false,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`Windows packager exited with status ${result.status}`);
    }

    postprocessPdfJsAssets({ zipPath });
    assertReleaseRuntime(packageDir, zipPath);
    console.log('[release] PDF.js and Canvas runtime verified in release folder and ZIP');
}

if (require.main === module) {
    main();
}

module.exports = {
    assertInside,
    assertReleaseRuntime,
    postprocessPdfJsAssets,
    requiredDirectories,
    requiredFiles,
    requiredRuntimeFiles,
};
