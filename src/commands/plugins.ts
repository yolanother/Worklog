/**
 * Plugins command - List discovered plugins and their load status
 */

import type { PluginContext } from '../plugin-types.js';
import { resolvePluginDir, discoverPlugins } from '../plugin-loader.js';
import * as fs from 'fs';
import * as path from 'path';

interface PluginsCommandOptions {
  verbose?: boolean;
}

export default function register(ctx: PluginContext): void {
  const { program, output } = ctx;
  
  program
    .command('plugins')
    .description('List discovered plugins and their load status')
    .action((options: PluginsCommandOptions) => {
      const pluginDir = resolvePluginDir({ verbose: options.verbose });
      const verbose = program.opts().verbose || options.verbose;
      
      // Check if plugin directory exists
      const dirExists = fs.existsSync(pluginDir);
      
      if (!dirExists) {
        if (ctx.utils.isJsonMode()) {
          output.json({
            success: true,
            pluginDir,
            dirExists: false,
            plugins: []
          });
        } else {
          console.log(`Plugin directory: ${pluginDir}`);
          console.log('Status: Directory does not exist');
          console.log('\nNo plugins configured.');
          console.log(`To add plugins, create ${pluginDir} and add .js or .mjs files.`);
        }
        return;
      }
      
      // Discover plugins
      const pluginPaths = discoverPlugins(pluginDir);
      
      if (ctx.utils.isJsonMode()) {
        const plugins = pluginPaths.map(p => ({
          name: path.basename(p),
          path: p,
          size: fs.statSync(p).size
        }));
        
        output.json({
          success: true,
          pluginDir,
          dirExists: true,
          count: plugins.length,
          plugins
        });
      } else {
        console.log(`Plugin directory: ${pluginDir}`);
        console.log(`Status: ${dirExists ? 'Exists' : 'Does not exist'}`);
        console.log(`\nDiscovered ${pluginPaths.length} plugin(s):\n`);
        
        if (pluginPaths.length === 0) {
          console.log('  (none)');
          console.log('\nTo add plugins:');
          console.log('  1. Create compiled ESM plugin files (.js or .mjs)');
          console.log(`  2. Place them in ${pluginDir}`);
          console.log('  3. Run worklog --help to see new commands');
        } else {
          pluginPaths.forEach(p => {
            const name = path.basename(p);
            const stat = fs.statSync(p);
            const size = stat.size;
            console.log(`  • ${name} (${size} bytes)`);
            if (verbose) {
              console.log(`    Path: ${p}`);
            }
          });
          
          console.log('\nNote: Plugins are loaded at CLI startup.');
          console.log('Run with --verbose to see plugin load diagnostics.');
        }
      }
    });
}
