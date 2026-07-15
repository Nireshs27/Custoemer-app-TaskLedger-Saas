#!/usr/bin/env tsx
/**
 * CI Guard: Prevent occurrence key format regressions
 * 
 * Fails build if client code contains the legacy prefixed format:
 * - Bad: `entityType:${uuid}::${iso}` or `${entityType}:${id}::`
 * - Good: `${uuid}::${iso}` or `${id}::`
 * 
 * This catches regressions instantly without needing to run tests.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_SRC = join(__dirname, '../client/src');

// Pattern that matches the BAD legacy format
// Looks for: word characters followed by colon, then uuid pattern, then ::
const BAD_PATTERN = /['"`][\w_]+:\$\{[^}]+\}::/g;

// Also check for literal strings like "tax_legal_item:uuid::"
const BAD_LITERAL_PATTERN = /['"`][\w_]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::/gi;

function* walkFiles(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      // Skip node_modules and other build artifacts
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      yield* walkFiles(path);
    } else if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) {
      yield path;
    }
  }
}

let foundViolations = false;

console.log('🔍 Checking client code for legacy occurrence key format...\n');

for (const file of walkFiles(CLIENT_SRC)) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    
    // Check for template literal pattern
    const badMatches = line.match(BAD_PATTERN);
    if (badMatches) {
      foundViolations = true;
      console.error(`❌ ${file}:${lineNum}`);
      console.error(`   Found legacy format: ${line.trim()}`);
      console.error(`   Expected format: \${entityId}::\${iso} (no entityType prefix)\n`);
    }
    
    // Check for literal string pattern
    const badLiteralMatches = line.match(BAD_LITERAL_PATTERN);
    if (badLiteralMatches) {
      foundViolations = true;
      console.error(`❌ ${file}:${lineNum}`);
      console.error(`   Found legacy literal format: ${line.trim()}`);
      console.error(`   Expected format: <uuid>::<iso> (no entityType prefix)\n`);
    }
  });
}

if (foundViolations) {
  console.error('❌ Legacy occurrence key format detected!');
  console.error('   The correct format is: <uuid>::<ISO_Z>');
  console.error('   NOT: <entityType>:<uuid>::<ISO_Z>');
  console.error('\n   This prevents 400 errors from the server.\n');
  process.exit(1);
}

console.log('✅ No legacy occurrence key formats found\n');
process.exit(0);

