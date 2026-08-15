const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const releaseDir = path.join(rootDir, 'release');
const winUnpackedDir = path.join(releaseDir, 'win-unpacked');
const zipFileName = `Epoch-Trail-v${version}-Windows-x64-Portable.zip`;
const zipFilePath = path.join(releaseDir, zipFileName);

console.log(`📦 Packaging Epoch Trail v${version} for GitHub Releases...`);

if (!fs.existsSync(winUnpackedDir)) {
  console.error(`❌ win-unpacked directory not found at ${winUnpackedDir}. Please run 'npm run dist:win:dir' first.`);
  process.exit(1);
}

// Create ZIP using python3 zipfile module
const pyScript = `
import zipfile, os, sys

source_dir = sys.argv[1]
output_zip = sys.argv[2]

with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
    for root, dirs, files in os.walk(source_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, source_dir)
            arcname = os.path.join("Epoch Trail", rel_path)
            zipf.write(full_path, arcname)

print("ZIP archive created successfully.")
`;

const pyScriptPath = path.join(releaseDir, '_create_zip.py');
fs.writeFileSync(pyScriptPath, pyScript.trim());

try {
  console.log(`⏳ Compressing '${winUnpackedDir}' into '${zipFileName}'...`);
  execSync(`python3 "${pyScriptPath}" "${winUnpackedDir}" "${zipFilePath}"`, { stdio: 'inherit' });
  fs.unlinkSync(pyScriptPath);
} catch (err) {
  if (fs.existsSync(pyScriptPath)) fs.unlinkSync(pyScriptPath);
  console.error('❌ Failed to create zip file:', err);
  process.exit(1);
}

// Generate SHA256 Checksum
const fileBuffer = fs.readFileSync(zipFilePath);
const hashSum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
const checksumLine = `${hashSum}  ${zipFileName}\n`;
const checksumPath = path.join(releaseDir, 'SHA256SUMS.txt');

fs.writeFileSync(checksumPath, checksumLine, 'utf8');

const stats = fs.statSync(zipFilePath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n========================================');
console.log('🎉 GitHub Release Artifacts Ready!');
console.log('========================================');
console.log(`📁 File:     ${zipFilePath} (${sizeMB} MB)`);
console.log(`🔑 SHA256:   ${hashSum}`);
console.log(`📋 Checksum: ${checksumPath}`);
console.log('========================================\n');
