import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('onboard command', () => {
  const testDir = '/tmp/test-wl-onboard-' + Math.random().toString(36).slice(2);
  
  beforeEach(() => {
    // Create test directory and initialize worklog
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    execSync(`wl init --project-name "Test" --prefix TEST --auto-export yes --auto-sync no --agents-template skip --workflow-inline no`, 
      { stdio: 'pipe' });
  });
  
  afterEach(() => {
    // Clean up test directory
    process.chdir('/tmp');
    fs.rmSync(testDir, { recursive: true, force: true });
  });
  
  it('should create AGENTS.md when it does not exist', () => {
    const agentsPath = path.join(testDir, 'AGENTS.md');
    
    // Remove AGENTS.md if it was created during init
    if (fs.existsSync(agentsPath)) {
      fs.unlinkSync(agentsPath);
    }
    
    // Run onboard command
    const output = execSync(`wl onboard`, { encoding: 'utf-8' });
    
    // Check file was created
    expect(fs.existsSync(agentsPath)).toBe(true);
    
    // Check output mentions creation
    expect(output).toContain('Created:');
    expect(output).toContain('✓ AGENTS.md');
    expect(output).toContain('Onboarding setup complete!');
    
    // Check file content
    const content = fs.readFileSync(agentsPath, 'utf-8');
    expect(content).toContain('## work-item Tracking with Worklog (wl)');
    expect(content).toContain('IMPORTANT: This project uses Worklog (wl)');
  });
  
  it('should skip existing AGENTS.md without --force', () => {
    const agentsPath = path.join(testDir, 'AGENTS.md');
    
    // Create AGENTS.md with custom content
    fs.writeFileSync(agentsPath, '# Custom AGENTS.md\n');
    
    // Run onboard command
    const output = execSync(`wl onboard`, { encoding: 'utf-8' });
    
    // Check file was not modified
    const content = fs.readFileSync(agentsPath, 'utf-8');
    expect(content).toBe('# Custom AGENTS.md\n');
    
    // Check output mentions skipping
    expect(output).toContain('⚠ AGENTS.md already exists');
    expect(output).toContain('Skipped (already exist):');
    expect(output).toContain('Use --force to overwrite');
  });
  
  it('should overwrite existing AGENTS.md with --force', () => {
    const agentsPath = path.join(testDir, 'AGENTS.md');
    
    // Create AGENTS.md with custom content
    fs.writeFileSync(agentsPath, '# Custom AGENTS.md\n');
    
    // Run onboard command with --force
    const output = execSync(`wl onboard --force`, { encoding: 'utf-8' });
    
    // Check file was overwritten
    const content = fs.readFileSync(agentsPath, 'utf-8');
    expect(content).toContain('## work-item Tracking with Worklog (wl)');
    expect(content).not.toBe('# Custom AGENTS.md\n');
    
    // Check output mentions update
    expect(output).toContain('Updated:');
    expect(output).toContain('✓ AGENTS.md');
  });
  
  it('should create GitHub Copilot instructions with --copilot', () => {
    const copilotPath = path.join(testDir, '.github', 'copilot-instructions.md');
    
    // Run onboard command with --copilot
    const output = execSync(`wl onboard --copilot`, { encoding: 'utf-8' });
    
    // Check file was created
    expect(fs.existsSync(copilotPath)).toBe(true);
    
    // Check output mentions creation
    expect(output).toContain('Created:');
    expect(output).toContain('✓ .github/copilot-instructions.md');
    
    // Check file content
    const content = fs.readFileSync(copilotPath, 'utf-8');
    expect(content).toContain('# Instructions for GitHub Copilot');
    expect(content).toContain('This repository uses Worklog (wl)');
  });
  
  it('should handle --dry-run without creating files', () => {
    const agentsPath = path.join(testDir, 'AGENTS.md');
    const copilotPath = path.join(testDir, '.github', 'copilot-instructions.md');
    
    // Remove AGENTS.md if it exists
    if (fs.existsSync(agentsPath)) {
      fs.unlinkSync(agentsPath);
    }
    
    // Run onboard command with --dry-run
    const output = execSync(`wl onboard --dry-run --copilot`, { encoding: 'utf-8' });
    
    // Check files were not created
    expect(fs.existsSync(agentsPath)).toBe(false);
    expect(fs.existsSync(copilotPath)).toBe(false);
    
    // Check output mentions dry run
    expect(output).toContain('DRY RUN: The following changes would be made:');
    expect(output).toContain('Would create: AGENTS.md');
    expect(output).toContain('Would create: .github/copilot-instructions.md');
    expect(output).toContain('No files were created (dry run mode)');
  });
  
  it('should fail when worklog is not initialized', () => {
    // Create a new directory without initializing worklog
    const uninitDir = '/tmp/test-wl-uninit-' + Math.random().toString(36).slice(2);
    fs.mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    
    try {
      // Try to run onboard command
      execSync(`wl onboard`, { encoding: 'utf-8' });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Check error message
      expect(error.stdout || error.stderr).toContain('Worklog is not initialized');
      expect(error.stdout || error.stderr).toContain('Run "wl init" first');
    } finally {
      // Clean up
      process.chdir('/tmp');
      fs.rmSync(uninitDir, { recursive: true, force: true });
    }
  });
});