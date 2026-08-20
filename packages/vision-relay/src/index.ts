#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import pc from 'picocolors'
import { loadConfig, validateConfig } from './config.js'
import { hookMain } from './hook.js'
import { runMcpServer } from './mcp.js'
import { setupAllDetected, setupInteractive } from './setup.js'
import { initWizard, testConnection } from './tui.js'
import { doctor } from './doctor.js'

const require = createRequire(import.meta.url)
const { version, description } = require('../package.json') as {
  version: string
  description: string
}

const program = new Command()

program
  .name('vision-relay')
  .version(version)
  .description(description)

program
  .command('init')
  .description('问答式配置视觉模型（协议/URL/模型/密钥），可立即测试连接')
  .action(() => initWizard())

program
  .command('setup')
  .description('自动接线到 Claude Code / Codex / opencode（hook + MCP + /vision 命令）')
  .option('--all', '不询问，配置所有已检测到的终端')
  .action((opts: { all?: boolean }) => (opts.all ? setupAllDetected() : setupInteractive()))

program
  .command('test')
  .description('发送测试图验证视觉模型连通性')
  .action(async () => {
    try {
      const { config, exists } = loadConfig()
      if (!exists) {
        console.log(pc.yellow('未找到配置，请先运行 vision-relay init'))
        return
      }
      const errs = validateConfig(config)
      if (errs.length) {
        console.log(pc.yellow(`配置不完整: ${errs.join('; ')}`))
        return
      }
      await testConnection(config)
    } catch {
      process.exitCode = 1
    }
  })

program
  .command('doctor')
  .description('检查配置完整性与三终端接线状态')
  .action(() => doctor())

program
  .command('mcp', { hidden: true })
  .description('stdio MCP server（由终端拉起，无需手动运行）')
  .action(() => runMcpServer())

program
  .command('hook', { hidden: true })
  .description('Claude Code UserPromptSubmit hook 处理器')
  .action(() => hookMain())

program.parseAsync(process.argv)
