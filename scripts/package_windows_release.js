const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const AdmZip = require('adm-zip');

const repoRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(repoRoot, 'release');
const packageName = 'houhi-win-x64';
const packageDir = path.join(releaseRoot, packageName);
const appDir = path.join(packageDir, 'app');
const runtimeDir = path.join(packageDir, 'runtime');
const electronDestDir = path.join(runtimeDir, 'electron');
const electronDistDir = path.join(repoRoot, 'node_modules', 'electron', 'dist');
const bundledNodeDir = path.join(runtimeDir, 'node');
const launcherProject = path.join(repoRoot, 'platforms', 'windows', 'launcher', 'Launcher.csproj');
const nodeExecutableName = process.platform === 'win32' ? 'node.exe' : 'node';
const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf-8'));

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '-',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

const releaseTimestamp = process.env.HOUHI_RELEASE_TIMESTAMP || formatTimestamp(new Date());
const zipPath = path.join(releaseRoot, `${packageName}-${releaseTimestamp}.zip`);
const electronLocalesToKeep = new Set(['en-US.pak', 'ja.pak']);
const rootPackageFilesToKeep = new Set([
    'package.json',
    'LICENSE',
    'LICENSE.md',
    'README.md',
    'Readme.md',
    'CHANGELOG.md'
]);

function normalizePath(value) {
    return value.replace(/\\/g, '/');
}

function assertInsideRepo(targetPath) {
    const resolved = path.resolve(targetPath);
    const root = path.resolve(repoRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Refusing to write outside repository: ${resolved}`);
    }
}

function removePath(targetPath) {
    assertInsideRepo(targetPath);
    if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    }
}

function run(command, args, options = {}) {
    const result = childProcess.spawnSync(command, args, {
        cwd: repoRoot,
        stdio: 'inherit',
        windowsHide: true,
        shell: false,
        ...options,
    });

    if (result.error) {
        throw new Error(`${command} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with status ${result.status}`);
    }
}

function copyDirectory(source, destination, filter = () => true) {
    if (!fs.existsSync(source)) {
        throw new Error(`Missing source directory: ${source}`);
    }

    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (!filter(sourcePath, destinationPath, entry)) {
            continue;
        }

        if (entry.isDirectory()) {
            copyDirectory(sourcePath, destinationPath, filter);
        } else if (entry.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(sourcePath);
            fs.symlinkSync(linkTarget, destinationPath);
        } else {
            fs.copyFileSync(sourcePath, destinationPath);
        }
    }
}

function copyFileIfExists(relativePath) {
    const sourcePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
        return false;
    }

    const destinationPath = path.join(appDir, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    return true;
}

function shouldCopyElectronRuntime(sourcePath, _destinationPath, entry) {
    const relative = normalizePath(path.relative(electronDistDir, sourcePath));
    const parts = relative.split('/');

    if (parts[0] === 'locales') {
        return parts.length === 1 || electronLocalesToKeep.has(entry.name);
    }

    return true;
}

function shouldCopyCanvasEntry(relative, entry) {
    const parts = relative.split('/');

    if (parts.length === 1) {
        return true;
    }

    const child = parts[1];
    if (child === 'build') {
        if (parts.length <= 3) {
            return true;
        }

        if (parts[2] !== 'Release') {
            return false;
        }

        if (entry.isDirectory()) {
            return false;
        }

        const extension = path.extname(entry.name).toLowerCase();
        return extension === '.dll' || extension === '.node';
    }

    return child === 'lib' ||
        child === 'index.js' ||
        child === 'package.json' ||
        child === 'Readme.md' ||
        child === 'CHANGELOG.md';
}

function shouldCopyPdfJsDistEntry(relative, entry) {
    const parts = relative.split('/');

    if (parts.length === 1) {
        return true;
    }

    const child = parts[1];
    if (rootPackageFilesToKeep.has(child)) {
        return true;
    }

    if (child === 'legacy') {
        if (parts.length <= 3) {
            return true;
        }
        if (parts[2] !== 'build' || entry.isDirectory()) {
            return false;
        }
        return entry.name === 'pdf.js' ||
            entry.name === 'pdf.worker.js' ||
            entry.name === 'pdf.worker.entry.js';
    }

    if (child === 'cmaps' || child === 'standard_fonts') {
        return true;
    }

    if (child === 'image_decoders') {
        if (parts.length === 2) {
            return true;
        }
        return !entry.isDirectory() && entry.name === 'pdf.image_decoders.js';
    }

    return false;
}

function shouldCopyPdfLibEntry(relative, entry) {
    const parts = relative.split('/');

    if (parts.length === 1) {
        return true;
    }

    const child = parts[1];
    if (rootPackageFilesToKeep.has(child)) {
        return true;
    }

    if (child === 'cjs') {
        return entry.isDirectory() || path.extname(entry.name).toLowerCase() === '.js';
    }

    return false;
}

function shouldCopyPdfLibScopeEntry(relative, entry) {
    const parts = relative.split('/');

    if (parts.length <= 2) {
        return true;
    }

    const packageName = parts[1];
    const child = parts[2];
    if (rootPackageFilesToKeep.has(child)) {
        return true;
    }

    if (packageName === 'fontkit') {
        if (child !== 'dist') {
            return false;
        }
        if (parts.length === 3) {
            return true;
        }
        return !entry.isDirectory() && entry.name === 'fontkit.umd.js';
    }

    if (packageName === 'standard-fonts') {
        if (child !== 'lib') {
            return false;
        }
        if (entry.isDirectory()) {
            return true;
        }
        const extension = path.extname(entry.name).toLowerCase();
        return extension === '.js' || extension === '.json';
    }

    if (packageName === 'upng') {
        if (child !== 'cjs') {
            return false;
        }
        return entry.isDirectory() || path.extname(entry.name).toLowerCase() === '.js';
    }

    return true;
}

function shouldCopyNodeModule(sourcePath, _destinationPath, entry) {
    const relative = normalizePath(path.relative(path.join(repoRoot, 'node_modules'), sourcePath));
    const parts = relative.split('/');
    const top = parts[0];

    if (!relative || relative === '.') return true;
    if (top === '.bin' || top === '.cache') return false;
    if (top === 'electron' || top === '@electron') return false;
    if (top === '@types' || top === 'typescript' || top === 'copyfiles') return false;
    if (entry.name === '.package-lock.json') return false;

    const packageName = top.startsWith('@') && parts.length > 1 ? `${top}/${parts[1]}` : top;
    if (packageName && packageLock.packages[`node_modules/${packageName}`]?.dev) {
        return false;
    }

    if (!entry.isDirectory()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (extension === '.map' || extension === '.ts') {
            return false;
        }
    }

    if (top === 'canvas') return shouldCopyCanvasEntry(relative, entry);
    if (top === 'pdfjs-dist') return shouldCopyPdfJsDistEntry(relative, entry);
    if (top === 'pdf-lib') return shouldCopyPdfLibEntry(relative, entry);
    if (top === '@pdf-lib') return shouldCopyPdfLibScopeEntry(relative, entry);
    return true;
}

function writeAppPackageJson() {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const appPackage = {
        name: 'houhi',
        productName: 'HOUHI',
        version: rootPackage.version || '0.0.0',
        private: true,
        main: 'dist/src/gui/main.js',
        dependencies: rootPackage.dependencies || {},
    };

    fs.writeFileSync(
        path.join(appDir, 'package.json'),
        JSON.stringify(appPackage, null, 2) + '\n',
        'utf-8',
    );
}

function copyBundledNodeRuntime() {
    const sourceNodePath = process.execPath;
    if (path.basename(sourceNodePath).toLowerCase() !== nodeExecutableName.toLowerCase()) {
        throw new Error(`Unexpected Node executable path: ${sourceNodePath}`);
    }

    fs.mkdirSync(bundledNodeDir, { recursive: true });
    fs.copyFileSync(sourceNodePath, path.join(bundledNodeDir, nodeExecutableName));

    const sourceNodeDir = path.dirname(sourceNodePath);
    for (const entry of fs.readdirSync(sourceNodeDir, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.dll') {
            continue;
        }
        fs.copyFileSync(path.join(sourceNodeDir, entry.name), path.join(bundledNodeDir, entry.name));
    }
}

function addDirectoryToZip(zip, directory, root = directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        const zipEntryPath = normalizePath(path.relative(root, fullPath));
        if (entry.isDirectory()) {
            addDirectoryToZip(zip, fullPath, root);
        } else if (entry.isFile()) {
            const zipDirectory = path.dirname(zipEntryPath);
            zip.addLocalFile(fullPath, zipDirectory === '.' ? '' : zipDirectory);
        }
    }
}

function createZip() {
    removePath(zipPath);
    const zip = new AdmZip();
    addDirectoryToZip(zip, packageDir, releaseRoot);
    zip.writeZip(zipPath);
}

function buildLauncher() {
    run('dotnet', [
        'publish',
        launcherProject,
        '-c',
        'Release',
        `-p:PublishDir=${packageDir}${path.sep}`,
    ]);
}

function writeReadmeStart() {
    const text = [
        'HOUHI Windows リリースパッケージ',
        '',
        '起動:',
        '  houhi.exe をダブルクリックしてください。',
        '',
        'このパッケージには Electron と Node.js 実行環境を同梱しているため、',
        '利用者側で Node.js / npm / .NET ランタイムをインストールする必要はありません。',
        '',
        '構成:',
        '  app/      アプリ本体',
        '  runtime/  同梱実行環境',
        '',
    ].join('\r\n');
    fs.writeFileSync(path.join(packageDir, 'README-START.txt'), text, 'utf-8');
}

function main() {
    if (process.platform !== 'win32') {
        throw new Error('Windows release packaging must run on Windows.');
    }
    if (!fs.existsSync(path.join(electronDistDir, 'electron.exe'))) {
        throw new Error('Electron runtime is missing. Run `npm install` first.');
    }
    if (!fs.existsSync(path.join(repoRoot, 'dist', 'src', 'gui', 'main.js'))) {
        throw new Error('Build output is missing. Run `npm run build` first.');
    }

    fs.mkdirSync(releaseRoot, { recursive: true });
    removePath(packageDir);
    fs.mkdirSync(packageDir, { recursive: true });

    console.log(`[release] copying Electron runtime to ${electronDestDir}`);
    copyDirectory(electronDistDir, electronDestDir, shouldCopyElectronRuntime);

    console.log('[release] copying application files');
    fs.mkdirSync(appDir, { recursive: true });
    copyBundledNodeRuntime();
    copyDirectory(path.join(repoRoot, 'dist'), path.join(appDir, 'dist'));
    copyDirectory(path.join(repoRoot, 'node_modules'), path.join(appDir, 'node_modules'), shouldCopyNodeModule);
    copyFileIfExists('config.template.json');
    copyFileIfExists('houhi-drafting-kit.zip');
    copyFileIfExists('README.md');
    copyFileIfExists(path.join('platforms', 'windows', 'launcher', 'app.ico'));
    writeAppPackageJson();

    console.log('[release] building launcher');
    buildLauncher();
    writeReadmeStart();

    const houhiExe = path.join(packageDir, 'houhi.exe');
    const electronExe = path.join(electronDestDir, 'electron.exe');
    const mainJs = path.join(appDir, 'dist', 'src', 'gui', 'main.js');
    for (const requiredPath of [houhiExe, electronExe, mainJs, path.join(bundledNodeDir, nodeExecutableName)]) {
        if (!fs.existsSync(requiredPath)) {
            throw new Error(`Release output is incomplete: ${requiredPath}`);
        }
    }

    console.log(`[release] creating ${zipPath}`);
    createZip();

    console.log('[release] done');
    console.log(`[release] folder: ${packageDir}`);
    console.log(`[release] exe: ${houhiExe}`);
    console.log(`[release] zip: ${zipPath}`);
}

main();
