const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

async function main() {
  const repoRoot = __dirname ? path.resolve(__dirname, '..') : process.cwd();
  const programDir = path.join(repoRoot, 'program');
  const libPath = path.join(programDir, 'src', 'lib.rs');
  const idlDir = path.join(repoRoot, 'idl');

  if (!fs.existsSync(libPath)) {
    throw new Error(`Cannot find lib.rs at ${libPath}`);
  }

  const libContent = fs.readFileSync(libPath, 'utf8');
  const idMatch = libContent.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/);
  if (!idMatch) {
    throw new Error('Unable to parse program id from declare_id!("...") in lib.rs');
  }
  const programId = idMatch[1];

  // Derive program name from Cargo.toml [package].name
  const cargoTomlPath = path.join(programDir, 'Cargo.toml');
  const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  const nameMatch = cargoToml.match(/name\s*=\s*"([^"]+)"/);
  const programName = nameMatch ? nameMatch[1] : 'program';

  if (!fs.existsSync(idlDir)) fs.mkdirSync(idlDir, { recursive: true });

  // Ensure shank is installed
  const which = spawnSync('which', ['shank'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.log('Installing shank CLI...');
    const install = spawnSync('cargo', ['install', 'shank-cli'], { stdio: 'inherit' });
    if (install.status !== 0) {
      throw new Error('Failed to install shank-cli using cargo');
    }
  }

  if (!fs.existsSync(idlDir)) fs.mkdirSync(idlDir, { recursive: true });

  // Run shank IDL generation
  const res = spawnSync('shank', ['idl', '--crate-root', programDir, '--out-dir', idlDir, '--program-id', programId], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error('Shank CLI failed to generate IDL');
  }

  // Shank writes <programName>.json in idlDir
  const outPath = path.join(idlDir, `${programName}.json`);
  const canonicalPath = path.join(idlDir, 'qs_bridge.json');
  if (fs.existsSync(outPath) && path.basename(outPath) !== 'qs_bridge.json') {
    fs.copyFileSync(outPath, canonicalPath);
  }
  console.log('Shank IDL generation complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


