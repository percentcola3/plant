import { registerAppHandlers } from './handlers/app'
import { registerProjectBrowserHandlers } from './handlers/project-browser'
import { registerAiTaskHandlers } from './handlers/ai-tasks'
import { registerClaudeHandlers } from './handlers/claude'
import { registerEditorHandlers } from './handlers/editor'
import { registerGitHandlers } from './handlers/git'
import { registerRawHandlers } from './handlers/raw'
import { registerSagaHandlers } from './handlers/saga'
import { registerSettingsHandlers } from './handlers/settings'
import { registerSourceProjectHandlers } from './handlers/source-project'
import { registerSkillsHandlers } from './handlers/skills'
import { registerSystemHandlers } from './handlers/system'
import { registerTerminalHandlers } from './handlers/terminal'
import { registerWorkspaceHandlers } from './handlers/workspace'
import { registerWorkspaceWriteHandlers } from './handlers/workspace-write'
import { registerExternalHandlers } from './handlers/external'
import { registerDiagnosticsHandlers } from '../diagnostics/handlers'
import { assertAllChannelsRegistered } from './registry'

export function registerAllIpcHandlers(): void {
  registerAppHandlers()
  registerProjectBrowserHandlers()
  registerAiTaskHandlers()
  registerSettingsHandlers()
  registerDiagnosticsHandlers()
  registerSystemHandlers()
  registerGitHandlers()
  registerSagaHandlers()
  registerEditorHandlers()
  registerSourceProjectHandlers()
  registerTerminalHandlers()
  registerClaudeHandlers()
  registerWorkspaceHandlers()
  registerWorkspaceWriteHandlers()
  registerExternalHandlers()
  registerSkillsHandlers()
  registerRawHandlers()
  assertAllChannelsRegistered()
}
