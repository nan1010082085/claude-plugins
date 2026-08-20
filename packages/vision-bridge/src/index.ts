#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import pc from 'picocolors'

const require = createRequire(import.meta.url)
const { version, description } = require('../package.json') as {
  version: string
  description: string
}

const program = new Command()

program
  .name('vision-bridge')
  .version(version)
  .description(description)

program
  .command('init')
  .description('交互式初始化配置（视觉模型、端点、密钥）')
  .action(() => {
    console.log(pc.yellow('TODO(M1): TUI 配置向导，写入 ~/.config/vision-bridge/config.json'))
  })

program
  .command('start')
  .description('启动本地代理服务器（默认 127.0.0.1:8787）')
  .action(() => {
    console.log(pc.yellow('TODO(M1): 代理服务器，先实现无图请求透传'))
  })

program
  .command('test')
  .description('用一张测试图验证视觉模型连通性')
  .action(() => {
    console.log(pc.yellow('TODO(M1): 发送测试图到配置的视觉模型并校验响应'))
  })

program
  .command('doctor')
  .description('检查 Claude Code / Codex 的环境变量接线是否指向本代理')
  .action(() => {
    console.log(pc.yellow('TODO(M2): 检查 ANTHROPIC_BASE_URL / OPENAI_BASE_URL 等'))
  })

program
  .command('config')
  .description('打开交互式配置编辑')
  .action(() => {
    console.log(pc.yellow('TODO(M4): TUI 配置编辑'))
  })

program.parseAsync(process.argv)
